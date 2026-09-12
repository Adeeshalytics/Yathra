from django.db import migrations
from django.db.models import F, OuterRef, Subquery


def backfill(apps, schema_editor):
    """Step 2 of 3: passengers learn their trip; older bookings get a price breakdown."""
    Booking = apps.get_model("bookings", "Booking")
    Passenger = apps.get_model("bookings", "Passenger")
    Trip = apps.get_model("trips", "Trip")

    Passenger.objects.update(
        trip_id=Subquery(Booking.objects.filter(pk=OuterRef("booking_id")).values("trip_id")[:1])
    )
    Passenger.objects.filter(booking__status__in=["cancelled", "expired"]).update(holds_seat=False)
    Booking.objects.update(
        subtotal=F("total_amount"),
        unit_price=Subquery(Trip.objects.filter(pk=OuterRef("trip_id")).values("base_price")[:1]),
    )


class Migration(migrations.Migration):
    dependencies = [
        ("bookings", "0002_booking_engine"),
        ("trips", "0004_trip_integrity_constraints"),
    ]

    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
