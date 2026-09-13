"""
Text messages: one small interface, and a backend for each way of sending.

    notifylk   Notify.lk (https://notify.lk), a Sri Lankan SMS gateway with a plain HTTP API
    console    writes each message to the log instead of sending it — development only, and
               refused in production because sign-in codes would end up in the logs
    locmem     keeps messages in `outbox`, for the test suite
    ""         text messages are switched off: nothing is sent, and phone sign-in is unavailable

Adding a gateway means one more subclass here; nothing else changes.
"""

import json
import logging
import uuid
from urllib import error, parse, request

from django.conf import settings

from .text import is_gsm, mask_phone

logger = logging.getLogger(__name__)


class SmsError(Exception):
    """A message wasn't sent. `retryable` says whether trying again later could help."""

    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class SmsBackend:
    name = ""

    def send(self, to: str, text: str) -> str:
        """Send `text` to an E.164 number. Returns the gateway's message id (or "")."""
        raise NotImplementedError


class ConsoleBackend(SmsBackend):
    name = "console"

    def send(self, to: str, text: str) -> str:
        logger.info("SMS to %s:\n%s", to, text)
        return f"console-{uuid.uuid4().hex[:12]}"


# Messages "sent" by the locmem backend, newest last. Tests clear it between runs.
outbox: list[dict[str, str]] = []


class LocmemBackend(SmsBackend):
    name = "locmem"

    def send(self, to: str, text: str) -> str:
        outbox.append({"to": to, "text": text})
        return f"locmem-{len(outbox)}"


class NotifyLkBackend(SmsBackend):
    """https://developer.notify.lk/api-endpoints/ — POST the message, read back a JSON status."""

    name = "notifylk"
    URL = "https://app.notify.lk/api/v1/send"

    def __init__(self):
        config = settings.SMS
        self.user_id = config.get("NOTIFYLK_USER_ID", "")
        self.api_key = config.get("NOTIFYLK_API_KEY", "")
        self.sender_id = config.get("SENDER_ID", "")
        self.timeout = float(config.get("TIMEOUT_SECONDS", 10))

    def send(self, to: str, text: str) -> str:
        if not (self.user_id and self.api_key and self.sender_id):
            raise SmsError(
                "Notify.lk needs NOTIFYLK_USER_ID, NOTIFYLK_API_KEY and SMS_SENDER_ID.",
                retryable=False,
            )
        fields = {
            "user_id": self.user_id,
            "api_key": self.api_key,
            "sender_id": self.sender_id,
            # Notify.lk wants the number without its "+": 9477XXXXXXX.
            "to": to.lstrip("+"),
            "message": text,
        }
        if not is_gsm(text):
            fields["type"] = "unicode"
        probe = request.Request(  # noqa: S310 — a fixed https:// address, not user input
            self.URL,
            data=parse.urlencode(fields).encode(),
            headers={"Accept": "application/json", "User-Agent": f"{settings.APP_NAME}/1.0"},
            method="POST",
        )
        try:
            with request.urlopen(probe, timeout=self.timeout) as response:  # noqa: S310
                payload = json.loads(response.read().decode() or "{}")
        except error.HTTPError as exc:
            # Never echo the request: it carries the API key.
            raise SmsError(
                f"Notify.lk answered HTTP {exc.code}.",
                retryable=exc.code >= 500 or exc.code == 429,
            ) from None
        except (error.URLError, TimeoutError, OSError) as exc:
            raise SmsError(f"Couldn't reach Notify.lk ({type(exc).__name__}).") from None
        except ValueError:
            raise SmsError("Notify.lk sent back something that isn't JSON.") from None

        if not isinstance(payload, dict):
            payload = {}
        if payload.get("status") != "success":
            reason = payload.get("errors") or payload.get("data") or "no reason given"
            logger.warning("Notify.lk refused a message to %s: %s", mask_phone(to), reason)
            raise SmsError(f"Notify.lk refused the message: {str(reason)[:120]}", retryable=False)
        return str(payload.get("data") or "")[:100]


BACKENDS: dict[str, type[SmsBackend]] = {
    ConsoleBackend.name: ConsoleBackend,
    LocmemBackend.name: LocmemBackend,
    NotifyLkBackend.name: NotifyLkBackend,
}


def backend_name() -> str:
    return (settings.SMS.get("BACKEND") or "").strip().lower()


def sms_enabled() -> bool:
    return backend_name() in BACKENDS


def get_backend() -> SmsBackend | None:
    """The configured backend, or None when text messages are switched off."""
    backend = BACKENDS.get(backend_name())
    return backend() if backend else None
