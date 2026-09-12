import re

from django.utils import timezone

from apps.accounts.models import UserRole
from apps.bookings.models import Booking
from apps.operators.models import OperatorMembership

from .models import Ticket
from .qr import read_ticket_code

TYPED_NUMBER = re.compile(r"TK[A-Z0-9]{10}")


def issue_ticket(booking: Booking, now=None) -> Ticket:
    """The booking's e-ticket, created on first confirmation (confirming again reuses it)."""
    ticket, _ = Ticket.objects.get_or_create(
        booking=booking, defaults={"issued_at": now or timezone.now()}
    )
    return ticket


def tickets_visible_to(user):
    """Tickets a member of staff may check: all for admins, their company's trips for operators."""
    tickets = Ticket.objects.select_related(
        "booking__trip__route__origin",
        "booking__trip__route__destination",
        "booking__trip__bus",
        "booking__trip__operator",
        "booking__boarding_stop",
        "booking__dropoff_stop",
    ).prefetch_related("booking__passengers")
    role = getattr(user, "role", None)
    if role == UserRole.ADMIN:
        return tickets
    if role == UserRole.OPERATOR:
        operators = OperatorMembership.objects.filter(user=user, is_active=True).values(
            "operator_id"
        )
        return tickets.filter(booking__trip__operator_id__in=operators)
    return tickets.none()


def find_ticket(code: str, user) -> Ticket | None:
    """
    The ticket behind a scanned QR code — or a ticket number typed by staff when a printout is
    too damaged to scan (numbers are random, so they can't be guessed). A QR code whose
    signature doesn't check out matches nothing.
    """
    code = code.strip()
    number = code.upper() if TYPED_NUMBER.fullmatch(code.upper()) else read_ticket_code(code)
    if number is None:
        return None
    return tickets_visible_to(user).filter(ticket_number=number).first()
