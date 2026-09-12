"""
The contract every payment gateway implements.

Booking and payment logic (apps.payments.services) talks only to this interface, so adding a
gateway means writing one subclass and listing its code in PAYMENT_PROVIDERS — nothing else in
the booking flow changes.

Every provider follows the hosted-checkout pattern: we send the customer to the gateway's own
page (or post a signed form to it), the customer types their card or wallet details there, and
the gateway tells our server the outcome in a signed notification. Card numbers, CVVs and PINs
never reach this server.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal


class ProviderError(Exception):
    """The gateway couldn't be reached, or refused the request."""


class RefundNotSupported(ProviderError):
    """This gateway can't make this refund through its API (do it in its merchant portal)."""


class InvalidNotification(Exception):
    """A notification whose signature or content doesn't check out. Never act on it."""


@dataclass(frozen=True)
class CheckoutSession:
    """
    How to send the customer to the gateway: `redirect` (open `url`) or `post` (submit
    `fields` to `url` as an HTML form, which is how PayHere's hosted checkout works).
    """

    method: str
    url: str
    fields: dict[str, str] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"method": self.method, "url": self.url, "fields": dict(self.fields)}


@dataclass(frozen=True)
class GatewayResult:
    """What the gateway says about one payment, from a notification or a status check."""

    reference: str  # our transaction_reference (the gateway's "order id")
    status: str  # a PaymentStatus value
    event_id: str = ""  # identifies this exact notification, for de-duplication
    provider_reference: str = ""  # the gateway's own id for the payment
    amount: Decimal | None = None
    currency: str = ""
    method: str = ""  # a PaymentMethod value, or ""
    message: str = ""
    data: dict = field(default_factory=dict)  # whitelisted fields only — safe to store


@dataclass(frozen=True)
class RefundResult:
    reference: str = ""
    message: str = ""


class PaymentProvider(ABC):
    code: str = ""
    name: str = ""
    description: str = ""
    test_mode: bool = False
    supports_refunds: bool = False

    def is_configured(self) -> bool:
        """False while credentials are missing: the provider is then never offered or used."""
        return True

    @abstractmethod
    def create_checkout(
        self, payment, *, return_url: str, cancel_url: str, notify_url: str
    ) -> CheckoutSession:
        """Start a hosted checkout for `payment` (no money moves yet)."""

    @abstractmethod
    def parse_notification(self, *, body: bytes, headers, data) -> GatewayResult:
        """Verify a gateway notification and translate it. Raise InvalidNotification if forged."""

    def fetch_status(self, payment) -> GatewayResult | None:
        """Ask the gateway directly what happened (None when it can't say)."""
        return None

    def refund(self, payment, amount: Decimal, reason: str) -> RefundResult:
        raise RefundNotSupported(
            f"{self.name} refunds are made in its merchant portal. Refund the payment there, "
            "then record the refund here."
        )

    def describe(self) -> dict:
        return {
            "code": self.code,
            "name": self.name,
            "description": self.description,
            "test_mode": self.test_mode,
        }
