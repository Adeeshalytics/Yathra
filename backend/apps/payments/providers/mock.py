"""
A built-in test gateway for development and demos. It behaves like a real hosted gateway — its
own checkout page, HMAC-signed server-to-server notifications, a status look-up API and refunds
— without moving money. It collects no card details at all.

It is only available when "mock" is listed in PAYMENT_PROVIDERS; production settings refuse to
start with it enabled.
"""

import hashlib
import hmac
import json
import secrets
from decimal import Decimal, InvalidOperation
from urllib.parse import urlencode

from django.conf import settings
from django.core import signing
from django.core.cache import cache

from ..models import PaymentMethod, PaymentStatus
from .base import (
    CheckoutSession,
    GatewayResult,
    InvalidNotification,
    PaymentProvider,
    RefundResult,
)

CHECKOUT_SALT = "yathra.payments.mock.checkout"
CHECKOUT_MAX_AGE = 60 * 60  # seconds a checkout link works
SIGNATURE_HEADER = "X-Mock-Signature"
STATE_TTL = 60 * 60 * 24 * 7
# What the test gateway reports, in its own words.
STATUSES = {
    "succeeded": PaymentStatus.SUCCESSFUL,
    "processing": PaymentStatus.PROCESSING,
    "failed": PaymentStatus.FAILED,
    "cancelled": PaymentStatus.CANCELLED,
    "refunded": PaymentStatus.REFUNDED,
}
SAFE_FIELDS = ("event_id", "order_id", "payment_id", "status", "amount", "currency", "method")


def _state_key(reference: str) -> str:
    return f"mock-gateway:{reference}"


class MockProvider(PaymentProvider):
    code = "mock"
    name = "Test card payment"
    description = "Simulated payment for testing — no real money moves."
    test_mode = True
    supports_refunds = True

    def is_configured(self) -> bool:
        return self.code in settings.PAYMENT_PROVIDERS

    # -- signing -------------------------------------------------------------------------
    @staticmethod
    def secret() -> bytes:
        configured = getattr(settings, "MOCK_PAYMENT_SECRET", "")
        if configured:
            return configured.encode()
        return hmac.new(
            settings.SECRET_KEY.encode(), b"yathra.mock-payments", hashlib.sha256
        ).digest()

    def sign(self, body: bytes) -> str:
        return hmac.new(self.secret(), body, hashlib.sha256).hexdigest()

    # -- checkout ------------------------------------------------------------------------
    def create_checkout(self, payment, *, return_url, cancel_url, notify_url) -> CheckoutSession:
        session = signing.dumps(
            {
                "ref": payment.transaction_reference,
                "return": return_url,
                "cancel": cancel_url,
            },
            salt=CHECKOUT_SALT,
        )
        query = urlencode({"session": session})
        return CheckoutSession(
            "redirect", f"{settings.PUBLIC_API_URL}/api/v1/payments/mock/checkout/?{query}"
        )

    @staticmethod
    def open_session(token: str) -> dict | None:
        try:
            return signing.loads(token, salt=CHECKOUT_SALT, max_age=CHECKOUT_MAX_AGE)
        except signing.BadSignature:
            return None

    # -- the simulated gateway's own records ----------------------------------------------
    def record(self, payment, *, status: str, method: str = "", message: str = "") -> dict:
        previous = cache.get(_state_key(payment.transaction_reference)) or {}
        state = {
            "order_id": payment.transaction_reference,
            "payment_id": previous.get("payment_id") or f"MOCK{secrets.token_hex(6).upper()}",
            "status": status,
            "amount": f"{payment.amount:.2f}",
            "currency": payment.currency,
            "method": method or previous.get("method", ""),
            "message": message,
        }
        cache.set(_state_key(payment.transaction_reference), state, STATE_TTL)
        return state

    def notification(self, state: dict, *, event_id: str | None = None) -> tuple[bytes, dict]:
        """A signed notification for `state`, as the gateway would POST it to us."""
        payload = {**state, "event_id": event_id or f"evt_{secrets.token_hex(8)}"}
        body = json.dumps(payload, separators=(",", ":")).encode()
        return body, {SIGNATURE_HEADER: self.sign(body)}

    # -- verification --------------------------------------------------------------------
    def parse_notification(self, *, body, headers, data) -> GatewayResult:
        signature = headers.get(SIGNATURE_HEADER, "") if headers else ""
        if not signature or not hmac.compare_digest(signature, self.sign(body)):
            raise InvalidNotification("The notification signature doesn't match.")
        try:
            payload = json.loads(body)
            return self._result(payload, event_id=str(payload["event_id"]))
        except (ValueError, KeyError, TypeError, InvalidOperation) as exc:
            raise InvalidNotification("The notification is malformed.") from exc

    def _result(self, payload: dict, *, event_id: str) -> GatewayResult:
        status = STATUSES.get(payload["status"])
        if status is None:
            raise InvalidNotification(f"Unknown status {payload['status']!r}.")
        method = payload.get("method", "")
        return GatewayResult(
            reference=str(payload["order_id"]),
            status=status,
            event_id=event_id,
            provider_reference=str(payload.get("payment_id", "")),
            amount=Decimal(str(payload["amount"])),
            currency=str(payload.get("currency", "")),
            method=method if method in PaymentMethod.values else "",
            message=str(payload.get("message", ""))[:255],
            data={key: payload[key] for key in SAFE_FIELDS if key in payload},
        )

    def fetch_status(self, payment) -> GatewayResult | None:
        state = cache.get(_state_key(payment.transaction_reference))
        if not state:
            return None  # the customer never finished on the gateway's page
        return self._result(state, event_id=f"status:{state['payment_id']}:{state['status']}")

    def refund(self, payment, amount, reason) -> RefundResult:
        return RefundResult(reference=f"MOCKRF{secrets.token_hex(5).upper()}", message="Refunded")
