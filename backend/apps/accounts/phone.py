"""
Signing in with a phone number: a six-digit code by SMS, and nothing else to remember.

The rules, all enforced here rather than in the browser:

* A code is stored only as a keyed hash, works once, expires after a few minutes and allows a
  few wrong guesses before it locks. Asking for a new code retires the previous one.
* A phone can be sent a code once a minute and a handful of times an hour (on top of the
  per-client request throttles), so the endpoint can't be used to flood someone with texts.
* The answer to "send me a code" is the same whether or not the number has an account. Staff
  accounts (operators and admins) never sign in by SMS: their numbers are simply not texted.
* A new number gets a customer account on the spot. A number already on an account that has a
  password — but was never proven with a code — is not handed over on the strength of an SMS
  alone: the customer signs in with their password once, carrying a short-lived proof that they
  hold the phone, and from then on the code is enough.
"""

import logging
import secrets
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework import status
from rest_framework.exceptions import APIException, Throttled

from apps.core.exceptions import Conflict, ServiceUnavailable
from apps.core.logging import log_event
from apps.notifications.services import send_sign_in_code
from apps.notifications.sms import sms_enabled
from apps.notifications.text import mask_phone

from .models import PhoneVerification, User, UserRole

CODE_LENGTH = 6
HASH_SALT = "yathra.accounts.phone-code"
PROOF_SALT = "yathra.accounts.phone-proof"
PROOF_MAX_AGE = 10 * 60


def _config(key: str):
    return settings.PHONE_SIGN_IN[key]


class PhoneCodeError(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "code_invalid"
    default_detail = "That code isn’t right."

    def __init__(self, detail=None, code=None, details=None, status_code=None):
        super().__init__(detail, code)
        self.details = details
        if status_code is not None:
            self.status_code = status_code


@dataclass(frozen=True)
class CodeSent:
    phone: str
    expires_in: int
    resend_in: int

    def as_dict(self) -> dict:
        return {
            "phone": self.phone,
            "masked_phone": mask_phone(self.phone),
            "code_length": CODE_LENGTH,
            "expires_in": self.expires_in,
            "resend_in": self.resend_in,
        }


def _hash(verification: PhoneVerification, code: str) -> str:
    return salted_hmac(HASH_SALT, f"{verification.pk}:{code}", algorithm="sha256").hexdigest()


def _may_sign_in_by_phone(user: User | None) -> bool:
    return user is None or (user.role == UserRole.CUSTOMER and user.is_active)


def request_code(phone: str) -> CodeSent:
    """Text a sign-in code to `phone` (or quietly don't, for a staff number)."""
    now = timezone.now()
    resend_seconds = int(_config("RESEND_SECONDS"))
    recent = PhoneVerification.objects.filter(phone=phone, created_at__gt=now - timedelta(hours=1))
    latest = recent.first()
    if latest and latest.created_at > now - timedelta(seconds=resend_seconds):
        wait = resend_seconds - (now - latest.created_at).total_seconds()
        raise Throttled(wait=max(1, int(wait)), detail="Please wait a moment before asking again.")
    if recent.count() >= int(_config("MAX_CODES_PER_HOUR")):
        oldest = recent.order_by("created_at").first()
        wait = 3600 - (now - oldest.created_at).total_seconds()
        raise Throttled(
            wait=max(1, int(wait)),
            detail="Too many codes for this number. Please try again later.",
        )
    if not sms_enabled():
        raise ServiceUnavailable(
            "Signing in with a text message isn’t available right now. "
            "Please sign in with your email instead.",
            code="sms_unavailable",
        )

    user = User.objects.filter(phone=phone).first()
    minutes = int(_config("CODE_TTL_MINUTES"))
    code = "".join(secrets.choice("0123456789") for _ in range(CODE_LENGTH))
    with transaction.atomic():
        PhoneVerification.objects.filter(phone=phone, consumed_at__isnull=True).update(
            consumed_at=now, updated_at=now
        )
        verification = PhoneVerification(phone=phone, expires_at=now + timedelta(minutes=minutes))
        verification.code_hash = _hash(verification, code)
        verification.save()

    if not _may_sign_in_by_phone(user):
        # Same answer as for anyone else, but nothing is texted and the code can never work.
        PhoneVerification.objects.filter(pk=verification.pk).update(consumed_at=now)
        log_event(
            "auth.phone_code_withheld",
            level=logging.WARNING,
            phone=mask_phone(phone),
            reason="inactive" if user.role == UserRole.CUSTOMER else "staff",
        )
    elif not send_sign_in_code(phone, code, minutes):
        PhoneVerification.objects.filter(pk=verification.pk).update(consumed_at=now)
        raise ServiceUnavailable(
            "We couldn’t send a text to that number. Check it and try again.",
            code="sms_failed",
        )
    else:
        log_event("auth.phone_code_sent", phone=mask_phone(phone))
    return CodeSent(phone=phone, expires_in=minutes * 60, resend_in=resend_seconds)


def _check(phone: str, code: str) -> PhoneCodeError | None:
    """Spend one guess on the phone's current code. Returns why it failed, or None."""
    now = timezone.now()
    limit = int(_config("MAX_ATTEMPTS"))
    with transaction.atomic():
        verification = (
            PhoneVerification.objects.select_for_update()
            .filter(phone=phone, consumed_at__isnull=True)
            .order_by("-created_at")
            .first()
        )
        if verification is None or verification.expires_at <= now:
            return PhoneCodeError(
                "This code has expired or was replaced. Ask for a new one.", code="code_expired"
            )
        verification.attempts += 1
        if constant_time_compare(verification.code_hash, _hash(verification, code)):
            verification.consumed_at = now
            verification.save(update_fields=["attempts", "consumed_at", "updated_at"])
            return None
        left = limit - verification.attempts
        if left <= 0:
            verification.consumed_at = now
        verification.save(update_fields=["attempts", "consumed_at", "updated_at"])
    if left <= 0:
        return PhoneCodeError(
            "That was the last try for this code. Ask for a new one.",
            code="too_many_attempts",
            details={"attempts_left": 0},
        )
    return PhoneCodeError(
        f"That code isn’t right. You have {left} {'try' if left == 1 else 'tries'} left.",
        code="code_invalid",
        details={"attempts_left": left},
    )


def make_phone_proof(phone: str) -> str:
    return signing.dumps({"phone": phone}, salt=PROOF_SALT)


def read_phone_proof(token: str) -> str | None:
    """The phone a proof vouches for, or None if it was tampered with or is too old."""
    try:
        return signing.loads(token, salt=PROOF_SALT, max_age=PROOF_MAX_AGE).get("phone")
    except (signing.BadSignature, AttributeError, TypeError):
        return None


def verify_code(phone: str, code: str) -> tuple[User, bool]:
    """Sign in with a texted code. Returns (user, whether the account was just created)."""
    failure = _check(phone, code)
    if failure is not None:
        log_event(
            "auth.phone_code_rejected",
            level=logging.WARNING,
            phone=mask_phone(phone),
            reason=failure.get_codes(),
        )
        raise failure

    user = User.objects.filter(phone=phone).first()
    if user is None:
        try:
            with transaction.atomic():
                user = User.objects.create_phone_customer(phone)
        except IntegrityError:  # two tabs verified at once: the other one created it
            user = User.objects.get(phone=phone)
        else:
            log_event("auth.registered", user_id=str(user.pk), role=user.role, method="phone")
            return user, True

    if not _may_sign_in_by_phone(user):
        raise PhoneCodeError(
            "This number belongs to a staff account. Please sign in with your email and password.",
            code="phone_sign_in_unavailable",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    if user.phone_verified_at is None:
        if user.has_usable_password():
            raise Conflict(
                "This number is already on an account with a password. Sign in with your email "
                "and password once to link it — after that, a code is all you need.",
                code="password_required",
                details={"phone_proof": make_phone_proof(phone)},
            )
        user.phone_verified_at = timezone.now()
        user.save(update_fields=["phone_verified_at", "updated_at"])
    return user, False


def link_proven_phone(user: User, token: str) -> bool:
    """After a password sign-in: mark the account's phone as proven, if the proof is for it."""
    phone = read_phone_proof(token)
    if not phone or phone != user.phone or user.phone_verified_at is not None:
        return False
    user.phone_verified_at = timezone.now()
    user.save(update_fields=["phone_verified_at", "updated_at"])
    log_event("auth.phone_linked", user_id=str(user.pk), phone=mask_phone(phone))
    return True
