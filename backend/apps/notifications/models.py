from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.models import BaseModel

DEDUPE_CONSTRAINT = "notifications_dedupe_key_unique"


class NotificationKind(models.TextChoices):
    TICKET = "ticket", "E-ticket"
    TICKET_RESENT = "ticket_resent", "E-ticket sent again"
    TRIP_REMINDER = "trip_reminder", "Departure reminder"
    SIGN_IN_CODE = "sign_in_code", "Sign-in code"


class NotificationChannel(models.TextChoices):
    SMS = "sms", "Text message"
    EMAIL = "email", "E-mail"


class NotificationStatus(models.TextChoices):
    PENDING = "pending", "Waiting to send"
    SENDING = "sending", "Sending"
    SENT = "sent", "Sent"
    FAILED = "failed", "Failed"
    SKIPPED = "skipped", "Not sent"


class Notification(BaseModel):
    """
    One text message or e-mail, from the moment it is queued to the gateway's answer.

    Rows are written in the same transaction as the change that caused them (a confirmed booking,
    say), so a message can't be lost between the two — and `dedupe_key` means a payment
    notification delivered twice still sends one ticket. Delivery happens afterwards, and the
    `send_notifications` command retries whatever didn't go through.
    """

    kind = models.CharField(max_length=24, choices=NotificationKind.choices)
    channel = models.CharField(max_length=8, choices=NotificationChannel.choices)
    status = models.CharField(
        max_length=12, choices=NotificationStatus.choices, default=NotificationStatus.PENDING
    )
    booking = models.ForeignKey(
        "bookings.Booking",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notifications",
    )
    recipient = models.CharField(max_length=254, help_text="An E.164 phone number or an e-mail.")
    subject = models.CharField(max_length=200, blank=True)
    body = models.TextField(help_text="Exactly what was sent (sign-in codes are never stored).")
    html = models.TextField(blank=True)
    # Set on messages that must go out only once (a booking's ticket, its reminder).
    dedupe_key = models.CharField(max_length=200, blank=True)
    provider = models.CharField(max_length=32, blank=True)
    provider_message_id = models.CharField(max_length=100, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(default=timezone.now)
    locked_until = models.DateTimeField(
        null=True, blank=True, help_text="A sender has claimed this message until then."
    )
    sent_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "next_attempt_at"], name="notifications_due_idx"),
            models.Index(fields=["booking", "-created_at"], name="notifications_booking_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["dedupe_key"],
                condition=~Q(dedupe_key=""),
                name=DEDUPE_CONSTRAINT,
            ),
            models.CheckConstraint(
                condition=Q(kind__in=NotificationKind.values), name="notifications_kind_valid"
            ),
            models.CheckConstraint(
                condition=Q(channel__in=NotificationChannel.values),
                name="notifications_channel_valid",
            ),
            models.CheckConstraint(
                condition=Q(status__in=NotificationStatus.values),
                name="notifications_status_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} by {self.get_channel_display().lower()}"
