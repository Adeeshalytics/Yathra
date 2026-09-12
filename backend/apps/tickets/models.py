import secrets

from django.db import IntegrityError, models, transaction

from apps.bookings.models import Booking, BookingStatus
from apps.bookings.references import REFERENCE_ALPHABET
from apps.core.db import violated_constraint
from apps.core.models import BaseModel

TICKET_NUMBER_CONSTRAINT = "tickets_ticket_number_unique"
MAX_NUMBER_ATTEMPTS = 5


class TicketStatus(models.TextChoices):
    VALID = "valid", "Valid"
    USED = "used", "Travelled"
    CANCELLED = "cancelled", "Cancelled"


def generate_ticket_number() -> str:
    """E.g. ``TK7KQ2M9XHAB``: random, so ticket numbers can't be guessed from one another."""
    return "TK" + "".join(secrets.choice(REFERENCE_ALPHABET) for _ in range(10))


class Ticket(BaseModel):
    """
    The e-ticket for a confirmed booking (one per booking, covering all its passengers). Its
    validity follows the booking: cancel the booking and the ticket stops being valid.
    """

    booking = models.OneToOneField(Booking, on_delete=models.PROTECT, related_name="ticket")
    ticket_number = models.CharField(max_length=16, editable=False)
    issued_at = models.DateTimeField()

    class Meta:
        ordering = ["-issued_at"]
        constraints = [
            models.UniqueConstraint(fields=["ticket_number"], name=TICKET_NUMBER_CONSTRAINT),
        ]

    def __str__(self) -> str:
        return self.ticket_number

    @property
    def is_valid(self) -> bool:
        """Good for travel: the booking is paid and the journey hasn't finished."""
        return self.booking.status == BookingStatus.CONFIRMED

    @property
    def status(self) -> str:
        """valid → used once the trip is completed; cancelled when the booking is."""
        if self.booking.status == BookingStatus.CONFIRMED:
            return TicketStatus.VALID
        if self.booking.status == BookingStatus.COMPLETED:
            return TicketStatus.USED
        return TicketStatus.CANCELLED

    def save(self, *args, **kwargs):
        if self.ticket_number:
            return super().save(*args, **kwargs)
        for attempt in range(1, MAX_NUMBER_ATTEMPTS + 1):
            self.ticket_number = generate_ticket_number()
            try:
                with transaction.atomic():
                    return super().save(*args, **kwargs)
            except IntegrityError as exc:
                self.ticket_number = ""
                if (
                    violated_constraint(exc) != TICKET_NUMBER_CONSTRAINT
                    or attempt == MAX_NUMBER_ATTEMPTS
                ):
                    raise
        return None
