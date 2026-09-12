"""
The authoritative booking price. Clients only ever display what this returns.

    total = ticket price × seats + service fee - discount + tax

Service fees and tax come from `settings.BOOKING_PRICING` (all zero by default):
SERVICE_FEE_PER_SEAT (LKR), SERVICE_FEE_PERCENT and TAX_PERCENT (of the amount after
discount). Discounts plug in through `discount_for` — promo codes and loyalty will live there.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings

CENT = Decimal("0.01")
HUNDRED = Decimal(100)


def money(value) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def _setting(name: str) -> Decimal:
    return Decimal(str(getattr(settings, "BOOKING_PRICING", {}).get(name, "0")))


@dataclass(frozen=True)
class PriceQuote:
    currency: str
    unit_price: Decimal
    seats: int
    subtotal: Decimal
    service_fee: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal

    def as_dict(self) -> dict:
        return {
            "currency": self.currency,
            "unit_price": str(self.unit_price),
            "seats": self.seats,
            "subtotal": str(self.subtotal),
            "service_fee": str(self.service_fee),
            "discount": str(self.discount),
            "tax": str(self.tax),
            "total": str(self.total),
        }


def discount_for(trip, seats: int, customer=None) -> Decimal:
    """Promotions hook. No discounts are offered yet."""
    return Decimal("0")


def quote(trip, seats: int, customer=None) -> PriceQuote:
    unit_price = money(trip.base_price)
    subtotal = money(unit_price * seats)
    service_fee = money(
        _setting("SERVICE_FEE_PER_SEAT") * seats
        + subtotal * _setting("SERVICE_FEE_PERCENT") / HUNDRED
    )
    discount = min(money(discount_for(trip, seats, customer)), subtotal + service_fee)
    taxable = subtotal + service_fee - discount
    tax = money(taxable * _setting("TAX_PERCENT") / HUNDRED)
    return PriceQuote(
        currency=settings.DEFAULT_CURRENCY,
        unit_price=unit_price,
        seats=seats,
        subtotal=subtotal,
        service_fee=service_fee,
        discount=discount,
        tax=tax,
        total=taxable + tax,
    )
