"""Issue e-tickets for bookings that were confirmed before tickets existed."""

import secrets

from django.db import migrations

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # apps.bookings.references.REFERENCE_ALPHABET


def forwards(apps, schema_editor):
    Booking = apps.get_model("bookings", "Booking")
    Ticket = apps.get_model("tickets", "Ticket")
    taken = set(Ticket.objects.values_list("ticket_number", flat=True))
    tickets = []
    for booking in Booking.objects.filter(
        status__in=("confirmed", "completed"), ticket__isnull=True
    ).only("pk", "confirmed_at", "created_at"):
        number = ""
        while not number or number in taken:
            number = "TK" + "".join(secrets.choice(ALPHABET) for _ in range(10))
        taken.add(number)
        tickets.append(
            Ticket(
                booking=booking,
                ticket_number=number,
                issued_at=booking.confirmed_at or booking.created_at,
            )
        )
    Ticket.objects.bulk_create(tickets, batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ('bookings', '0004_booking_engine_constraints'),
        ('tickets', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
