"""
Queueing and sending text messages and e-mails.

    queue      write the message down, inside the caller's transaction
    dispatch   once that transaction commits, send what was queued (straight away, in the
               background — see NOTIFICATIONS["DELIVERY"])
    deliver    claim due messages, hand each to its gateway, and record the answer

A message is claimed before it is sent (status "sending", with a lock that runs out), so the
immediate send and the `send_notifications` command can never both deliver the same message. A
failure worth retrying goes back to "pending" with a growing delay; after MAX_ATTEMPTS it stays
"failed", visible on the booking in the admin console.
"""

import logging
import threading
from collections import Counter
from datetime import timedelta

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import close_old_connections, connections, transaction
from django.db.models import DateTimeField, Exists, ExpressionWrapper, F, OuterRef, Q
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.bookings.models import Booking, BookingStatus
from apps.core.logging import log_event
from apps.payments.models import CAPTURED_PAYMENT_STATUSES
from apps.tickets.models import Ticket
from apps.tickets.pdf import render_ticket_pdf
from apps.trips.models import OPEN_TRIP_STATUSES

from . import messages
from .models import Notification, NotificationChannel, NotificationKind, NotificationStatus
from .sms import SmsError, get_backend, sms_enabled
from .text import mask_recipient

logger = logging.getLogger(__name__)

CLAIM_MINUTES = 5
# Minutes to wait before attempt 2, 3, 4, 5…
RETRY_DELAYS = (1, 5, 15, 60)
# The same ticket isn't sent to the same phone again within this long ("Find my booking").
RESEND_COOLDOWN = timedelta(minutes=2)
BOOKING_KINDS = (
    NotificationKind.TICKET,
    NotificationKind.TICKET_RESENT,
    NotificationKind.TRIP_REMINDER,
)


def _config(key: str, default=None):
    return settings.NOTIFICATIONS.get(key, default)


def email_enabled() -> bool:
    return not settings.EMAIL_BACKEND.endswith("dummy.EmailBackend")


# ---------------------------------------------------------------------------
# Who hears about a booking
# ---------------------------------------------------------------------------
def booking_for_messages(booking_id) -> Booking:
    """A booking with everything a message mentions, in a handful of queries."""
    return (
        Booking.objects.select_related(
            "customer",
            "trip__route__origin",
            "trip__route__destination",
            "trip__bus",
            "trip__operator",
            "boarding_stop",
            "dropoff_stop",
            "ticket",
        )
        .prefetch_related("passengers", "payments")
        .get(pk=booking_id)
    )


def phone_recipients(booking: Booking) -> list[str]:
    """The account holder's phone first, then every passenger's — each number once."""
    numbers = [booking.customer.phone, *(p.phone for p in booking.passengers.all())]
    return list(dict.fromkeys(number for number in numbers if number))


def email_recipients(booking: Booking) -> list[str]:
    addresses = [booking.customer.email, *(p.email for p in booking.passengers.all())]
    return list(dict.fromkeys(a.strip().lower() for a in addresses if a and a.strip()))


# ---------------------------------------------------------------------------
# Queueing
# ---------------------------------------------------------------------------
def queue(
    *,
    kind: str,
    channel: str,
    recipient: str,
    body: str,
    subject: str = "",
    html: str = "",
    booking: Booking | None = None,
    dedupe_key: str = "",
) -> Notification | None:
    """
    Write a message down. Returns it when it still has to be sent, or None when it was already
    queued under the same key (or can't be sent because that channel is switched off — then it
    is recorded as "not sent", so the booking's history says why).
    """
    fields = {
        "kind": kind,
        "channel": channel,
        "recipient": recipient,
        "body": body,
        "subject": subject[:200],
        "html": html,
        "booking": booking,
        "dedupe_key": dedupe_key,
    }
    enabled = sms_enabled() if channel == NotificationChannel.SMS else email_enabled()
    if not enabled:
        fields["status"] = NotificationStatus.SKIPPED
        fields["last_error"] = (
            "Text messages are switched off."
            if channel == NotificationChannel.SMS
            else "E-mail is switched off."
        )
    if dedupe_key:
        fields.pop("dedupe_key")
        notification, created = Notification.objects.get_or_create(
            dedupe_key=dedupe_key, defaults=fields
        )
        if not created:
            return None
    else:
        notification = Notification.objects.create(**fields)
    return notification if notification.status == NotificationStatus.PENDING else None


def _queue_ticket(booking: Booking, kind: str, *, phones=None, emails=None) -> list[Notification]:
    ticket = booking.ticket
    url = ticket.share_url
    once = kind == NotificationKind.TICKET
    queued = []
    sms = messages.ticket_sms(booking, url)
    for phone in phone_recipients(booking) if phones is None else phones:
        queued.append(
            queue(
                kind=kind,
                channel=NotificationChannel.SMS,
                recipient=phone,
                body=sms,
                booking=booking,
                dedupe_key=f"{kind}:{booking.pk}:sms:{phone}" if once else "",
            )
        )
    addresses = email_recipients(booking) if emails is None else emails
    if addresses:
        subject, text, html = messages.ticket_email(booking, url)
        for address in addresses:
            queued.append(
                queue(
                    kind=kind,
                    channel=NotificationChannel.EMAIL,
                    recipient=address,
                    subject=subject,
                    body=text,
                    html=html,
                    booking=booking,
                    dedupe_key=f"{kind}:{booking.pk}:email:{address}" if once else "",
                )
            )
    return [notification for notification in queued if notification]


def notify_booking_confirmed(booking: Booking) -> list[Notification]:
    """
    The booking is paid: send its e-ticket by SMS and e-mail to the account holder and every
    passenger. Call inside the confirming transaction — nothing is sent unless it commits, and a
    second confirmation (a duplicate payment notification) sends nothing new.
    """
    queued = _queue_ticket(booking_for_messages(booking.pk), NotificationKind.TICKET)
    dispatch(queued)
    return queued


def resend_ticket(booking: Booking, *, phone: str | None = None) -> list[Notification]:
    """
    Send the e-ticket again: to one phone (a customer who lost their SMS), or to everyone on the
    booking (support). A phone that already asked for it again in the last two minutes is
    skipped, so "Find my booking" can't be used to flood someone with texts.
    """
    booking = booking_for_messages(booking.pk)
    if booking.status != BookingStatus.CONFIRMED:
        return []
    if phone is not None:
        recent = Notification.objects.filter(
            booking=booking,
            recipient=phone,
            kind=NotificationKind.TICKET_RESENT,
            created_at__gt=timezone.now() - RESEND_COOLDOWN,
        ).exists()
        queued = (
            []
            if recent
            else _queue_ticket(booking, NotificationKind.TICKET_RESENT, phones=[phone], emails=[])
        )
    else:
        queued = _queue_ticket(booking, NotificationKind.TICKET_RESENT)
    dispatch(queued)
    return queued


def queue_trip_reminders(now=None) -> int:
    """
    Queue an SMS reminder for every paid booking whose bus leaves within the next few hours
    (NOTIFICATIONS["REMINDER_HOURS_BEFORE"]) — unless it was booked inside that window, when the
    ticket has only just arrived. Returns how many bookings were reminded.
    """
    hours = int(_config("REMINDER_HOURS_BEFORE", 3))
    if hours <= 0 or not sms_enabled():
        return 0
    now = now or timezone.now()
    lead = timedelta(hours=hours)
    already = Notification.objects.filter(
        booking=OuterRef("pk"), kind=NotificationKind.TRIP_REMINDER
    )
    due = (
        Booking.objects.annotate(departure=Coalesce("boarding_time", "trip__departure_datetime"))
        .annotate(
            window_opens=ExpressionWrapper(F("departure") - lead, output_field=DateTimeField())
        )
        .filter(
            status=BookingStatus.CONFIRMED,
            trip__status__in=OPEN_TRIP_STATUSES,
            departure__gt=now,
            departure__lte=now + lead,
            confirmed_at__lte=F("window_opens"),
        )
        .filter(~Exists(already))
        .values_list("pk", flat=True)
    )
    reminded = 0
    for booking_id in list(due):
        booking = booking_for_messages(booking_id)
        try:
            ticket = booking.ticket
        except Ticket.DoesNotExist:
            continue
        text = messages.reminder_sms(booking, ticket.share_url, now)
        with transaction.atomic():
            for phone in phone_recipients(booking):
                queue(
                    kind=NotificationKind.TRIP_REMINDER,
                    channel=NotificationChannel.SMS,
                    recipient=phone,
                    body=text,
                    booking=booking,
                    dedupe_key=f"{NotificationKind.TRIP_REMINDER}:{booking.pk}:sms:{phone}",
                )
        reminded += 1
    if reminded:
        log_event("notification.reminders_queued", bookings=reminded)
    return reminded


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------
def dispatch(notifications) -> None:
    """Send these once the current transaction commits (how, is up to settings)."""
    ids = [notification.pk for notification in notifications if notification]
    mode = _config("DELIVERY", "thread")
    if not ids or mode == "worker":
        return
    if mode == "inline":
        transaction.on_commit(lambda: deliver_due(ids=ids))
    else:
        transaction.on_commit(lambda: _in_background(ids))


def _in_background(ids) -> None:
    def run():
        close_old_connections()
        try:
            deliver_due(ids=ids)
        except Exception:
            # Whatever wasn't sent stays queued; send_notifications picks it up.
            logger.exception("Sending notifications in the background failed.")
        finally:
            connections.close_all()

    threading.Thread(target=run, name="notifications", daemon=True).start()


def _claim(*, ids=None, limit: int = 100, now=None) -> list[Notification]:
    now = now or timezone.now()
    due = Notification.objects.filter(
        Q(status=NotificationStatus.PENDING, next_attempt_at__lte=now)
        | Q(status=NotificationStatus.SENDING, locked_until__lte=now)
    )
    if ids is not None:
        due = due.filter(pk__in=ids)
    with transaction.atomic():
        claimed = list(
            due.select_for_update(skip_locked=True)
            .order_by("next_attempt_at")
            .values_list("pk", flat=True)[:limit]
        )
        Notification.objects.filter(pk__in=claimed).update(
            status=NotificationStatus.SENDING,
            locked_until=now + timedelta(minutes=CLAIM_MINUTES),
            attempts=F("attempts") + 1,
            updated_at=now,
        )
    return list(
        Notification.objects.filter(pk__in=claimed)
        .select_related("booking__trip")
        .order_by("created_at")
    )


def deliver_due(*, ids=None, limit: int = 100, now=None) -> Counter:
    """Send due messages (or just `ids`). Returns how many ended up in each status."""
    outcome = Counter()
    for notification in _claim(ids=ids, limit=limit, now=now):
        outcome[_deliver(notification)] += 1
    return outcome


def _still_wanted(notification: Notification) -> str:
    """Why a booking message shouldn't go out any more ("" if it should)."""
    if notification.kind not in BOOKING_KINDS:
        return ""
    booking = notification.booking
    if booking is None or booking.status != BookingStatus.CONFIRMED:
        return "The booking is no longer confirmed."
    if notification.kind == NotificationKind.TRIP_REMINDER:
        departure = booking.boarding_time or booking.trip.departure_datetime
        if departure <= timezone.now():
            return "The bus had already left."
    return ""


def _send_email(notification: Notification) -> None:
    email = EmailMultiAlternatives(
        subject=notification.subject,
        body=notification.body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[notification.recipient],
    )
    if notification.html:
        email.attach_alternative(notification.html, "text/html")
    if notification.booking_id and notification.kind in (
        NotificationKind.TICKET,
        NotificationKind.TICKET_RESENT,
    ):
        booking = booking_for_messages(notification.booking_id)
        captured = [p for p in booking.payments.all() if p.status in CAPTURED_PAYMENT_STATUSES]
        payment = max(captured, key=lambda p: p.paid_at, default=None)
        email.attach(
            f"{settings.APP_NAME.lower()}-ticket-{booking.booking_reference}.pdf",
            render_ticket_pdf(booking.ticket, payment=payment),
            "application/pdf",
        )
    email.send(fail_silently=False)


def _deliver(notification: Notification) -> str:
    now = timezone.now()
    reason = _still_wanted(notification)
    if reason:
        return _finish(notification, NotificationStatus.SKIPPED, error=reason)

    try:
        if notification.channel == NotificationChannel.SMS:
            backend = get_backend()
            if backend is None:
                return _finish(
                    notification,
                    NotificationStatus.SKIPPED,
                    error="Text messages are switched off.",
                )
            message_id = backend.send(notification.recipient, notification.body)
            provider = backend.name
        else:
            _send_email(notification)
            message_id, provider = "", "email"
    except SmsError as exc:
        return _failed(notification, str(exc), retryable=exc.retryable, now=now)
    except Exception as exc:  # SMTP errors, a template that won't render, a PDF that won't draw
        logger.exception("Sending notification %s failed.", notification.pk)
        return _failed(notification, f"{type(exc).__name__}: {exc}", retryable=True, now=now)

    return _finish(
        notification,
        NotificationStatus.SENT,
        provider=provider,
        message_id=message_id,
        now=now,
    )


def _failed(notification: Notification, error: str, *, retryable: bool, now) -> str:
    attempts = notification.attempts or 1
    if retryable and attempts < int(_config("MAX_ATTEMPTS", 5)):
        delay = RETRY_DELAYS[min(attempts, len(RETRY_DELAYS)) - 1]
        notification.next_attempt_at = now + timedelta(minutes=delay)
        return _finish(notification, NotificationStatus.PENDING, error=error, now=now)
    return _finish(notification, NotificationStatus.FAILED, error=error, now=now)


def _finish(
    notification: Notification,
    status: str,
    *,
    error: str = "",
    provider: str = "",
    message_id: str = "",
    now=None,
) -> str:
    now = now or timezone.now()
    notification.status = status
    notification.locked_until = None
    notification.last_error = error[:300]
    fields = ["status", "locked_until", "last_error", "next_attempt_at", "updated_at"]
    if status == NotificationStatus.SENT:
        notification.sent_at = now
        notification.provider = provider
        notification.provider_message_id = message_id[:100]
        fields += ["sent_at", "provider", "provider_message_id"]
    notification.save(update_fields=fields)

    event = {
        NotificationStatus.SENT: "notification.sent",
        NotificationStatus.PENDING: "notification.retrying",
        NotificationStatus.FAILED: "notification.failed",
        NotificationStatus.SKIPPED: "notification.skipped",
    }[status]
    log_event(
        event,
        level=logging.WARNING if status == NotificationStatus.FAILED else logging.INFO,
        notification_id=str(notification.pk),
        kind=notification.kind,
        channel=notification.channel,
        recipient=mask_recipient(notification.recipient),
        booking_id=str(notification.booking_id) if notification.booking_id else None,
        attempts=notification.attempts,
        error=error[:200] or None,
    )
    return status


def send_sign_in_code(phone: str, code: str, minutes: int) -> bool:
    """
    Text a sign-in code now, while the customer waits. It is never queued for later (a late code
    is useless) and never stored: the log keeps only that one was sent.
    """
    backend = get_backend()
    if backend is None:
        return False
    notification = Notification.objects.create(
        kind=NotificationKind.SIGN_IN_CODE,
        channel=NotificationChannel.SMS,
        status=NotificationStatus.SENDING,
        recipient=phone,
        body="(sign-in code, not stored)",
        attempts=1,
    )
    try:
        message_id = backend.send(phone, messages.sign_in_sms(code, minutes))
    except SmsError as exc:
        _finish(notification, NotificationStatus.FAILED, error=str(exc))
        return False
    _finish(notification, NotificationStatus.SENT, provider=backend.name, message_id=message_id)
    return True
