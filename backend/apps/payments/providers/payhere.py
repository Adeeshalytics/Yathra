"""
PayHere (payhere.lk), Sri Lanka's most widely used payment gateway: Visa, Mastercard, Amex,
eZ Cash, mCash, Genie, FriMi and online banking.

Flow: we post a hashed form to PayHere's hosted checkout; the customer pays on PayHere; PayHere
POSTs a notification (form-encoded, signed with an MD5 of the merchant secret) to our notify
URL and sends the customer back to our return URL. Only the notification changes anything.

Credentials come from the environment (PAYHERE_MERCHANT_ID / PAYHERE_MERCHANT_SECRET, plus the
optional PAYHERE_APP_ID / PAYHERE_APP_SECRET for the status and refund APIs).
"""

import base64
import hashlib
import hmac
import json
import logging
from decimal import Decimal, InvalidOperation
from urllib import error, request
from urllib.parse import quote, urlencode

from django.conf import settings

from ..models import PaymentMethod, PaymentStatus
from .base import (
    CheckoutSession,
    GatewayResult,
    InvalidNotification,
    PaymentProvider,
    ProviderError,
    RefundNotSupported,
    RefundResult,
)

logger = logging.getLogger("apps.payments.payhere")

LIVE_URL = "https://www.payhere.lk"
SANDBOX_URL = "https://sandbox.payhere.lk"
API_TIMEOUT = 10  # seconds

# status_code in PayHere notifications.
STATUS_CODES = {
    "2": PaymentStatus.SUCCESSFUL,
    "0": PaymentStatus.PROCESSING,
    "-1": PaymentStatus.CANCELLED,
    "-2": PaymentStatus.FAILED,
    "-3": PaymentStatus.REFUNDED,  # charged back
}
METHODS = {
    "VISA": PaymentMethod.CARD,
    "MASTER": PaymentMethod.CARD,
    "AMEX": PaymentMethod.CARD,
    "DISCOVER": PaymentMethod.CARD,
    "DINERS": PaymentMethod.CARD,
    "EZCASH": PaymentMethod.MOBILE_WALLET,
    "MCASH": PaymentMethod.MOBILE_WALLET,
    "GENIE": PaymentMethod.MOBILE_WALLET,
    "FRIMI": PaymentMethod.MOBILE_WALLET,
    "PAYAPP": PaymentMethod.MOBILE_WALLET,
    "VISHWA": PaymentMethod.BANK_TRANSFER,
    "HNB": PaymentMethod.BANK_TRANSFER,
    "BANK": PaymentMethod.BANK_TRANSFER,
}
# The only notification fields we keep. PayHere also sends card_holder_name, card_no (masked)
# and card_expiry: those are dropped on arrival and never stored or logged.
SAFE_FIELDS = (
    "payment_id",
    "order_id",
    "payhere_amount",
    "payhere_currency",
    "status_code",
    "status_message",
    "method",
)


def md5_upper(value: str) -> str:
    return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest().upper()


def format_amount(amount) -> str:
    """PayHere's amount format: two decimals, no thousands separator."""
    return f"{Decimal(amount).quantize(Decimal('0.01')):.2f}"


def first_passenger(booking, field: str) -> str:
    return next((getattr(p, field) for p in booking.passengers.all() if getattr(p, field)), "")


def payer_email(booking) -> str:
    """PayHere insists on an e-mail. Customers who booked with only a phone may not have one."""
    return (
        booking.customer.email
        or first_passenger(booking, "email")
        or settings.PAYMENT_FALLBACK_EMAIL
    )


class PayHereProvider(PaymentProvider):
    code = "payhere"
    name = "PayHere"
    description = "Visa, Mastercard, Amex, eZ Cash, mCash, Genie and online banking."

    @property
    def config(self) -> dict:
        return settings.PAYHERE

    def is_configured(self) -> bool:
        return bool(self.config.get("MERCHANT_ID") and self.config.get("MERCHANT_SECRET"))

    @property
    def test_mode(self) -> bool:  # type: ignore[override]
        return bool(self.config.get("SANDBOX", True))

    @property
    def supports_refunds(self) -> bool:  # type: ignore[override]
        return bool(self.config.get("APP_ID") and self.config.get("APP_SECRET"))

    @property
    def base_url(self) -> str:
        return SANDBOX_URL if self.test_mode else LIVE_URL

    # -- hashing -------------------------------------------------------------------------
    def _secret_hash(self) -> str:
        return md5_upper(self.config["MERCHANT_SECRET"])

    def checkout_hash(self, order_id: str, amount: str, currency: str) -> str:
        merchant_id = self.config["MERCHANT_ID"]
        return md5_upper(f"{merchant_id}{order_id}{amount}{currency}{self._secret_hash()}")

    def notification_signature(self, data) -> str:
        return md5_upper(
            f"{data.get('merchant_id', '')}{data.get('order_id', '')}"
            f"{data.get('payhere_amount', '')}{data.get('payhere_currency', '')}"
            f"{data.get('status_code', '')}{self._secret_hash()}"
        )

    # -- checkout ------------------------------------------------------------------------
    def create_checkout(self, payment, *, return_url, cancel_url, notify_url) -> CheckoutSession:
        booking = payment.booking
        customer = booking.customer
        first_name, _, last_name = (customer.name or "Customer").strip().partition(" ")
        amount = format_amount(payment.amount)
        city = booking.boarding_stop.city if booking.boarding_stop_id else "Colombo"
        fields = {
            "merchant_id": self.config["MERCHANT_ID"],
            "return_url": return_url,
            "cancel_url": cancel_url,
            "notify_url": notify_url,
            "order_id": payment.transaction_reference,
            "items": f"Bus ticket {booking.booking_reference}",
            "currency": payment.currency,
            "amount": amount,
            "first_name": first_name or "Customer",
            "last_name": last_name or "-",
            "email": payer_email(booking),
            "phone": str(customer.phone or first_passenger(booking, "phone")),
            "address": "Not provided",
            "city": city,
            "country": "Sri Lanka",
            "custom_1": booking.booking_reference,
            "hash": self.checkout_hash(payment.transaction_reference, amount, payment.currency),
        }
        return CheckoutSession("post", f"{self.base_url}/pay/checkout", fields)

    # -- notifications -------------------------------------------------------------------
    def parse_notification(self, *, body, headers, data) -> GatewayResult:
        required = ("merchant_id", "order_id", "payhere_amount", "payhere_currency", "status_code")
        if not data or any(not data.get(key) for key in (*required, "md5sig")):
            raise InvalidNotification("The notification is missing required fields.")
        if data["merchant_id"] != self.config["MERCHANT_ID"]:
            raise InvalidNotification("The notification is for another merchant.")
        if not hmac.compare_digest(self.notification_signature(data), data["md5sig"].upper()):
            raise InvalidNotification("The notification signature doesn't match.")
        status = STATUS_CODES.get(data["status_code"])
        if status is None:
            raise InvalidNotification(f"Unknown status code {data['status_code']!r}.")
        try:
            amount = Decimal(data["payhere_amount"])
        except InvalidOperation as exc:
            raise InvalidNotification("The notification amount isn't a number.") from exc
        payment_id = data.get("payment_id", "")
        return GatewayResult(
            reference=data["order_id"],
            status=status,
            event_id=f"{payment_id or data['order_id']}:{data['status_code']}",
            provider_reference=payment_id,
            amount=amount,
            currency=data["payhere_currency"],
            method=METHODS.get(str(data.get("method", "")).upper(), ""),
            message=str(data.get("status_message", ""))[:255],
            data={key: data[key] for key in SAFE_FIELDS if data.get(key)},
        )

    # -- merchant API (optional) ---------------------------------------------------------
    def _call(self, path: str, *, method="GET", headers=None, body: bytes | None = None) -> dict:
        req = request.Request(  # noqa: S310 — fixed https base URL
            f"{self.base_url}{path}", data=body, method=method, headers=headers or {}
        )
        try:
            with request.urlopen(req, timeout=API_TIMEOUT) as response:  # noqa: S310
                return json.loads(response.read().decode() or "{}")
        except error.HTTPError as exc:
            raise ProviderError(f"PayHere answered {exc.code}.") from exc
        except (error.URLError, TimeoutError, ValueError) as exc:
            raise ProviderError("PayHere couldn't be reached.") from exc

    def _token(self) -> str:
        credentials = f"{self.config['APP_ID']}:{self.config['APP_SECRET']}".encode()
        reply = self._call(
            "/merchant/v1/oauth/token",
            method="POST",
            headers={
                "Authorization": f"Basic {base64.b64encode(credentials).decode()}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body=urlencode({"grant_type": "client_credentials"}).encode(),
        )
        token = reply.get("access_token")
        if not token:
            raise ProviderError("PayHere didn't issue an API token.")
        return token

    def fetch_status(self, payment) -> GatewayResult | None:
        if not self.supports_refunds:  # the same Business App keys unlock both APIs
            return None
        token = self._token()
        reply = self._call(
            f"/merchant/v1/payment/search?order_id={quote(payment.transaction_reference)}",
            headers={"Authorization": f"Bearer {token}"},
        )
        rows = reply.get("data") or []
        if reply.get("status") != 1 or not rows:
            return None
        row = rows[0]
        text = str(row.get("status", "")).upper()
        if text == "RECEIVED":
            status = PaymentStatus.SUCCESSFUL
        elif "REFUND" in text or "CHARGEBACK" in text:
            status = PaymentStatus.REFUNDED
        elif text in ("FAILED", "DECLINED"):
            status = PaymentStatus.FAILED
        elif text in ("CANCELED", "CANCELLED"):
            status = PaymentStatus.CANCELLED
        else:
            return None
        method = row.get("method")
        method_name = method.get("method", "") if isinstance(method, dict) else str(method or "")
        payment_id = str(row.get("payment_id", ""))
        try:
            amount = Decimal(str(row.get("amount")))
        except InvalidOperation:
            amount = None
        return GatewayResult(
            reference=payment.transaction_reference,
            status=status,
            event_id=f"status:{payment_id}:{text}",
            provider_reference=payment_id,
            amount=amount,
            currency=str(row.get("currency", "")),
            method=METHODS.get(method_name.upper(), ""),
            message=f"PayHere reports {text.lower()}",
            data={"payment_id": payment_id, "status": text, "method": method_name},
        )

    def refund(self, payment, amount, reason) -> RefundResult:
        if not self.supports_refunds:
            return super().refund(payment, amount, reason)
        if amount != payment.amount - payment.refunded_amount:
            raise RefundNotSupported(
                "PayHere's API refunds the whole payment. For a partial refund, refund it in "
                "the PayHere merchant portal, then record it here."
            )
        if not payment.provider_reference:
            raise ProviderError("PayHere hasn't reported a payment id for this payment yet.")
        reply = self._call(
            "/merchant/v1/payment/refund",
            method="POST",
            headers={
                "Authorization": f"Bearer {self._token()}",
                "Content-Type": "application/json",
            },
            body=json.dumps(
                {"payment_id": payment.provider_reference, "description": reason or "Refund"}
            ).encode(),
        )
        if reply.get("status") != 1:
            raise ProviderError(str(reply.get("msg") or "PayHere refused the refund."))
        return RefundResult(reference=str(reply.get("data") or ""), message=str(reply.get("msg")))
