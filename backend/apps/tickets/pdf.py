"""Printable A4 e-tickets, drawn with ReportLab (no browser or system fonts needed)."""

from io import BytesIO

from django.conf import settings
from django.utils import timezone
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

from .models import Ticket, TicketStatus
from .qr import QUIET_ZONE, dark_runs, qr_matrix, ticket_code

BRAND = HexColor("#0B6E69")
INK = HexColor("#0F172A")
MUTED = HexColor("#64748B")
LINE = HexColor("#E2E8F0")
SOFT = HexColor("#F1F5F9")
STATUS_COLOURS = {
    TicketStatus.VALID: HexColor("#15803D"),
    TicketStatus.USED: HexColor("#475569"),
    TicketStatus.CANCELLED: HexColor("#B91C1C"),
}
REGULAR, BOLD = "Helvetica", "Helvetica-Bold"


def _local(value):
    return timezone.localtime(value)


def format_date(value) -> str:
    local = _local(value)
    return f"{local:%a}, {local.day} {local:%b %Y}"


def format_time(value) -> str:
    return _local(value).strftime("%I:%M %p").lstrip("0")


def format_money(amount, currency: str) -> str:
    return f"{currency} {amount:,.2f}"


def _lines(text: str, font: str, size: float, width: float, limit: int = 2) -> list[str]:
    lines = simpleSplit(text or "—", font, size, width) or ["—"]
    if len(lines) > limit:
        lines = [*lines[: limit - 1], lines[limit - 1].rstrip() + "…"]
    return lines


def _field(pdf, x, y, label: str, value: str, note: str = "", width: float = 160) -> None:
    pdf.setFillColor(MUTED)
    pdf.setFont(REGULAR, 7.5)
    pdf.drawString(x, y, label.upper())
    pdf.setFillColor(INK)
    pdf.setFont(BOLD, 11.5)
    line_y = y - 15
    for line in _lines(value, BOLD, 11.5, width):
        pdf.drawString(x, line_y, line)
        line_y -= 14
    if note:
        pdf.setFillColor(MUTED)
        pdf.setFont(REGULAR, 9)
        pdf.drawString(x, line_y, _lines(note, REGULAR, 9, width, limit=1)[0])


def _pill(pdf, right: float, y: float, text: str, colour) -> None:
    pdf.setFont(BOLD, 9)
    width = pdf.stringWidth(text, BOLD, 9) + 20
    pdf.setFillColor(colour)
    pdf.roundRect(right - width, y - 5, width, 20, 10, stroke=0, fill=1)
    pdf.setFillColor(white)
    pdf.drawCentredString(right - width / 2, y + 1.5, text)


def _qr(pdf, value: str, x: float, y: float, size: float) -> None:
    matrix = qr_matrix(value)
    module = size / (len(matrix) + QUIET_ZONE * 2)
    pdf.setFillColor(white)
    pdf.rect(x, y, size, size, stroke=0, fill=1)
    pdf.setFillColor(INK)
    for row, start, length in dark_runs(matrix):
        pdf.rect(
            x + (start + QUIET_ZONE) * module,
            y + size - (row + QUIET_ZONE + 1) * module,
            length * module,
            module,
            stroke=0,
            fill=1,
        )


def render_ticket_pdf(ticket: Ticket, payment=None) -> bytes:
    booking = ticket.booking
    trip = booking.trip
    route = trip.route
    passengers = sorted(booking.passengers.all(), key=lambda p: _seat_key(p.seat_number))
    boarding_time = booking.boarding_time or trip.departure_datetime

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4, pageCompression=1)
    pdf.setTitle(f"{settings.APP_NAME} e-ticket {booking.booking_reference}")
    pdf.setAuthor(settings.APP_NAME)
    pdf.setSubject(f"Bus ticket, {route.name}")
    width, height = A4
    left, right, top = 40, width - 40, height - 40

    # Header band.
    pdf.setFillColor(BRAND)
    pdf.roundRect(left, top - 84, right - left, 84, 12, stroke=0, fill=1)
    pdf.setFillColor(white)
    pdf.setFont(BOLD, 24)
    pdf.drawString(left + 22, top - 42, settings.APP_NAME)
    pdf.setFont(REGULAR, 10)
    pdf.drawString(left + 22, top - 62, "Bus e-ticket")
    pdf.setFont(REGULAR, 8)
    pdf.drawRightString(right - 22, top - 32, "BOOKING REFERENCE")
    pdf.setFont(BOLD, 20)
    pdf.drawRightString(right - 22, top - 58, booking.booking_reference)

    # Route and status.
    y = top - 122
    pdf.setFillColor(INK)
    pdf.setFont(BOLD, 17)
    pdf.drawString(left, y, _lines(route.name, BOLD, 17, 360, limit=1)[0])
    _pill(pdf, right, y, TicketStatus(ticket.status).label.upper(), STATUS_COLOURS[ticket.status])
    y -= 20
    origin = booking.boarding_stop.city if booking.boarding_stop else route.origin.city
    destination = booking.dropoff_stop.city if booking.dropoff_stop else route.destination.city
    pdf.setFillColor(MUTED)
    pdf.setFont(REGULAR, 10.5)
    pdf.drawString(left, y, f"{origin} to {destination}  ·  Trip {trip.code}")

    # Journey details (left) and QR code (right).
    grid_top = y - 36
    dropoff_time = booking.dropoff_time
    fields = [
        ("Travel date", format_date(boarding_time), ""),
        ("Departure time", format_time(boarding_time), "from your boarding point"),
        (
            "Boarding point",
            booking.boarding_stop.name if booking.boarding_stop else route.origin.name,
            "",
        ),
        (
            "Drop-off point",
            booking.dropoff_stop.name if booking.dropoff_stop else route.destination.name,
            f"arrives about {format_time(dropoff_time)}" if dropoff_time else "",
        ),
        ("Bus number", trip.bus.registration_number, trip.bus.get_bus_type_display()),
        ("Operator", trip.operator.company_name, ""),
    ]
    for index, (label, value, note) in enumerate(fields):
        column, row = index % 2, index // 2
        _field(pdf, left + column * 180, grid_top - row * 64, label, value, note, width=165)

    qr_size = 150
    qr_x, qr_y = right - qr_size, grid_top - qr_size + 12
    pdf.setFillColor(SOFT)
    pdf.roundRect(qr_x - 8, qr_y - 44, qr_size + 16, qr_size + 56, 10, stroke=0, fill=1)
    _qr(pdf, ticket_code(ticket.ticket_number), qr_x, qr_y, qr_size)
    pdf.setFillColor(MUTED)
    pdf.setFont(REGULAR, 7.5)
    pdf.drawCentredString(qr_x + qr_size / 2, qr_y - 16, "TICKET NUMBER")
    pdf.setFillColor(INK)
    pdf.setFont(BOLD, 11)
    pdf.drawCentredString(qr_x + qr_size / 2, qr_y - 31, ticket.ticket_number)

    # Passengers.
    y = grid_top - 3 * 64 - 22
    pdf.setFillColor(MUTED)
    pdf.setFont(BOLD, 8)
    pdf.drawString(left, y, "PASSENGERS")
    y -= 10
    pdf.setFillColor(SOFT)
    pdf.rect(left, y - 18, right - left, 18, stroke=0, fill=1)
    pdf.setFillColor(MUTED)
    pdf.setFont(BOLD, 8.5)
    pdf.drawString(left + 12, y - 12, "SEAT")
    pdf.drawString(left + 80, y - 12, "PASSENGER NAME")
    y -= 18
    pdf.setStrokeColor(LINE)
    for passenger in passengers:
        pdf.setFillColor(INK)
        pdf.setFont(BOLD, 11)
        pdf.drawString(left + 12, y - 15, passenger.seat_number)
        pdf.setFont(REGULAR, 11)
        pdf.drawString(left + 80, y - 15, _lines(passenger.name, REGULAR, 11, 380, limit=1)[0])
        y -= 22
        pdf.line(left, y, right, y)

    # Amount.
    y -= 30
    pdf.setFillColor(MUTED)
    pdf.setFont(REGULAR, 7.5)
    pdf.drawString(left, y, "AMOUNT PAID")
    pdf.setFillColor(INK)
    pdf.setFont(BOLD, 17)
    pdf.drawString(left, y - 20, format_money(booking.total_amount, booking.currency))
    seats = len(passengers)
    detail = f"{seats} seat{'s' if seats != 1 else ''}"
    if payment is not None:
        detail += f"  ·  Payment {payment.transaction_reference}"
        if payment.payment_method:
            detail += f" ({payment.get_payment_method_display()})"
    pdf.setFillColor(MUTED)
    pdf.setFont(REGULAR, 9.5)
    pdf.drawString(left, y - 36, detail)

    # How to use it.
    y -= 76
    pdf.setStrokeColor(LINE)
    pdf.line(left, y + 16, right, y + 16)
    pdf.setFillColor(INK)
    pdf.setFont(BOLD, 10)
    pdf.drawString(left, y, "When you travel")
    pdf.setFont(REGULAR, 9.5)
    pdf.setFillColor(MUTED)
    notes = [
        "Show this QR code to the conductor when you board, on your phone or printed.",
        "Be at your boarding point 15 minutes before the departure time above.",
        "This ticket is valid only for the passengers, seats and journey shown.",
    ]
    for note in notes:
        y -= 15
        pdf.drawString(left + 10, y, f"•  {note}")
    pdf.setFont(REGULAR, 8)
    pdf.drawString(
        left, 36, f"Issued {format_date(ticket.issued_at)}, {format_time(ticket.issued_at)}"
    )
    pdf.drawRightString(right, 36, f"{settings.APP_NAME} · {ticket.ticket_number}")

    if not ticket.is_valid and ticket.status == TicketStatus.CANCELLED:
        pdf.saveState()
        pdf.setFillColor(STATUS_COLOURS[TicketStatus.CANCELLED])
        pdf.setFillAlpha(0.12)
        pdf.translate(width / 2, height / 2)
        pdf.rotate(30)
        pdf.setFont(BOLD, 96)
        pdf.drawCentredString(0, 0, "CANCELLED")
        pdf.restoreState()

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _seat_key(number: str) -> tuple:
    return (0, int(number), "") if number.isdigit() else (1, 0, number)
