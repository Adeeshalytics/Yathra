import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Step 3 of 3: passenger.trip becomes required; double-booking constraints are added."""

    dependencies = [
        ("bookings", "0003_backfill_booking_engine"),
        ("trips", "0004_trip_integrity_constraints"),
    ]

    operations = [
        migrations.AlterField(
            model_name="passenger",
            name="trip",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="passengers",
                to="trips.trip",
            ),
        ),
        migrations.AddIndex(
            model_name="booking",
            index=models.Index(fields=["status", "expires_at"], name="bookings_status_expiry_idx"),
        ),
        migrations.AddIndex(
            model_name="passenger",
            index=models.Index(fields=["trip", "holds_seat"], name="bookings_passenger_trip_idx"),
        ),
        migrations.AddConstraint(
            model_name="booking",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("discount__gte", 0),
                    ("service_fee__gte", 0),
                    ("subtotal__gte", 0),
                    ("tax__gte", 0),
                    ("unit_price__gte", 0),
                ),
                name="bookings_booking_amounts_non_negative",
            ),
        ),
        migrations.AddConstraint(
            model_name="passenger",
            constraint=models.UniqueConstraint(
                condition=models.Q(("holds_seat", True)),
                fields=("trip", "seat_number"),
                name="bookings_passenger_seat_held_once",
            ),
        ),
    ]
