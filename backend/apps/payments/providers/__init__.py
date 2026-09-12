"""
Payment provider registry. Add a gateway by subclassing PaymentProvider, registering it in
PROVIDER_CLASSES and listing its code in the PAYMENT_PROVIDERS setting.
"""

from django.conf import settings

from .base import (
    CheckoutSession,
    GatewayResult,
    InvalidNotification,
    PaymentProvider,
    ProviderError,
    RefundNotSupported,
    RefundResult,
)
from .mock import MockProvider
from .payhere import PayHereProvider

# Payments recorded by staff (cash at the counter). Not a gateway: never offered to customers.
MANUAL_PROVIDER = "manual"

PROVIDER_CLASSES: dict[str, type[PaymentProvider]] = {
    MockProvider.code: MockProvider,
    PayHereProvider.code: PayHereProvider,
}

__all__ = [
    "MANUAL_PROVIDER",
    "CheckoutSession",
    "GatewayResult",
    "InvalidNotification",
    "PaymentProvider",
    "ProviderError",
    "RefundNotSupported",
    "RefundResult",
    "checkout_providers",
    "default_provider_code",
    "get_checkout_provider",
    "provider_for",
    "provider_label",
]


def provider_for(code: str) -> PaymentProvider | None:
    """
    The provider behind existing payments, if it's configured — used for notifications, status
    checks and refunds even after a gateway is taken off the checkout page.
    """
    cls = PROVIDER_CLASSES.get(code)
    if cls is None:
        return None
    provider = cls()
    return provider if provider.is_configured() else None


def checkout_providers() -> list[PaymentProvider]:
    """Gateways customers can choose at checkout, in the configured order."""
    providers = []
    for code in settings.PAYMENT_PROVIDERS:
        provider = provider_for(code)
        if provider is not None and provider.code not in {p.code for p in providers}:
            providers.append(provider)
    return providers


def get_checkout_provider(code: str) -> PaymentProvider | None:
    return next((p for p in checkout_providers() if p.code == code), None)


def default_provider_code() -> str:
    codes = [provider.code for provider in checkout_providers()]
    preferred = settings.PAYMENT_DEFAULT_PROVIDER
    return preferred if preferred in codes else (codes[0] if codes else "")


def provider_label(code: str) -> str:
    if code == MANUAL_PROVIDER:
        return "Counter"
    cls = PROVIDER_CLASSES.get(code)
    return cls.name if cls else code
