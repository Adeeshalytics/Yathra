"""
What each message says.

Everything a passenger needs at the bus door fits in one or two SMS parts: the booking reference,
where and when to board, the seats, the bus's number plate, and the ticket's own link (which
opens without signing in, so it works for whoever is actually travelling).
"""

from dataclasses import dataclass
from urllib.parse import urlsplit

from django.conf import settings
from django.template.loader import render_to_string
from django.utils import timezone

from apps.bookings.models import Booking

from .text import clock, day_phrase, seat_phrase, short_date, sms_safe


def seat_sort_key(number: str) -> tuple:
    """Seats in natural order (as apps.bookings.services does; that module sends these messages,
    so it can't be imported from here)."""
    return (0, int(number), "") if number.isdigit() else (1, 0, number)


@dataclass(frozen=True)
class Journey:
    """The passenger's own part of the trip, in the words a message uses."""

    reference: str
    origin: str
    destination: str
    boarding_point: str
    boarding_time: object
    dropoff_point: str
    dropoff_time: object
    seats: list[str]
    bus: str
    bus_name: str
    operator: str
    route: str


def journey(booking: Booking) -> Journey:
    trip = booking.trip
    route = trip.route
    boarding, dropoff = booking.boarding_stop, booking.dropoff_stop
    return Journey(
        reference=booking.booking_reference,
        origin=boarding.city if boarding else route.origin.city,
        destination=dropoff.city if dropoff else route.destination.city,
        boarding_point=boarding.name if boarding else route.origin.name,
        boarding_time=booking.boarding_time or trip.departure_datetime,
        dropoff_point=dropoff.name if dropoff else route.destination.name,
        dropoff_time=booking.dropoff_time or trip.estimated_arrival_datetime,
        seats=sorted((p.seat_number for p in booking.passengers.all()), key=seat_sort_key),
        bus=trip.bus.registration_number,
        bus_name=trip.bus.name,
        operator=trip.operator.company_name,
        route=route.name,
    )


def ticket_sms(booking: Booking, share_url: str) -> str:
    j = journey(booking)
    return sms_safe(
        f"{settings.APP_NAME} booking {j.reference} is confirmed.\n"
        f"{j.origin} to {j.destination}, {short_date(j.boarding_time)}. "
        f"Board at {j.boarding_point}, {clock(j.boarding_time)}.\n"
        f"{seat_phrase(j.seats)}. Bus {j.bus}.\n"
        f"Ticket: {share_url}"
    )


def reminder_sms(booking: Booking, share_url: str, now=None) -> str:
    j = journey(booking)
    return sms_safe(
        f"{settings.APP_NAME} reminder: your bus to {j.destination} leaves {j.boarding_point} "
        f"at {clock(j.boarding_time)} {day_phrase(j.boarding_time, now)}.\n"
        f"{seat_phrase(j.seats)}. Bus {j.bus}. Booking {j.reference}.\n"
        f"Ticket: {share_url}"
    )


def sign_in_sms(code: str, minutes: int) -> str:
    text = (
        f"{code} is your {settings.APP_NAME} sign-in code. It expires in {minutes} minutes. "
        "Never share it: our team will never ask you for it."
    )
    # The last line lets Android's WebOTP fill the code in for the customer
    # (https://wicg.github.io/web-otp/#message-format).
    host = urlsplit(settings.FRONTEND_URL).hostname
    if host:
        text += f"\n\n@{host} #{code}"
    return sms_safe(text)


def ticket_email(booking: Booking, share_url: str) -> tuple[str, str, str]:
    """(subject, text body, HTML body) for the e-ticket e-mail."""
    j = journey(booking)
    passengers = sorted(booking.passengers.all(), key=lambda p: seat_sort_key(p.seat_number))
    context = {
        "app_name": settings.APP_NAME,
        "journey": j,
        "date": timezone.localtime(j.boarding_time),
        "boarding_clock": clock(j.boarding_time),
        "dropoff_clock": clock(j.dropoff_time) if j.dropoff_time else "",
        "passengers": passengers,
        "total": f"{booking.currency} {booking.total_amount:,.2f}",
        "share_url": share_url,
        "frontend_url": settings.FRONTEND_URL,
    }
    subject = (
        f"Your {settings.APP_NAME} e-ticket {j.reference}: {j.origin} to {j.destination}, "
        f"{short_date(j.boarding_time)}"
    )
    text = render_to_string("notifications/email/ticket.txt", context)
    html = render_to_string("notifications/email/ticket.html", context)
    return subject, text, html
