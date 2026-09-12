import uuid
from decimal import Decimal

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

STATUSES = [
    ("pending", "Pending"),
    ("payment_pending", "Payment pending"),
    ("confirmed", "Confirmed"),
    ("cancelled", "Cancelled"),
    ("expired", "Expired"),
    ("completed", "Completed"),
]


def money():
    return models.DecimalField(decimal_places=2, default=Decimal("0"), max_digits=10)


class Migration(migrations.Migration):
    """Step 1 of 3: seat locks, booking journey/price/expiry fields, passenger ↔ trip."""

    dependencies = [
        ("bookings", "0001_initial"),
        ("routes", "0002_route_base_fare_and_case_insensitive_stops"),
        ("trips", "0004_trip_integrity_constraints"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RemoveConstraint(model_name="booking", name="bookings_booking_status_valid"),
        migrations.AlterField(
            model_name="booking",
            name="status",
            field=models.CharField(choices=STATUSES, default="pending", max_length=16),
        ),
        migrations.AddConstraint(
            model_name="booking",
            constraint=models.CheckConstraint(
                condition=models.Q(("status__in", [value for value, _ in STATUSES])),
                name="bookings_booking_status_valid",
            ),
        ),
        migrations.AddField(
            model_name="booking",
            name="boarding_stop",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="boarding_bookings",
                to="routes.stop",
            ),
        ),
        migrations.AddField(
            model_name="booking",
            name="dropoff_stop",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="dropoff_bookings",
                to="routes.stop",
            ),
        ),
        migrations.AddField(
            model_name="booking",
            name="boarding_time",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="booking",
            name="dropoff_time",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(model_name="booking", name="unit_price", field=money()),
        migrations.AddField(model_name="booking", name="subtotal", field=money()),
        migrations.AddField(model_name="booking", name="service_fee", field=money()),
        migrations.AddField(model_name="booking", name="discount", field=money()),
        migrations.AddField(model_name="booking", name="tax", field=money()),
        migrations.AddField(
            model_name="booking",
            name="expires_at",
            field=models.DateTimeField(
                blank=True, help_text="When an unpaid booking's seat hold runs out.", null=True
            ),
        ),
        migrations.AddField(
            model_name="booking",
            name="confirmed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="booking",
            name="cancelled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="booking",
            name="cancellation_reason",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="passenger",
            name="trip",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="passengers",
                to="trips.trip",
            ),
        ),
        migrations.AddField(
            model_name="passenger",
            name="holds_seat",
            field=models.BooleanField(
                default=True, help_text="Cleared when the booking is cancelled or expires."
            ),
        ),
        migrations.CreateModel(
            name="SeatLock",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("seat_number", models.CharField(max_length=8)),
                ("expires_at", models.DateTimeField()),
                (
                    "customer",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="seat_locks",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "trip",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="seat_locks",
                        to="trips.trip",
                    ),
                ),
            ],
            options={
                "ordering": ["trip", "seat_number"],
                "indexes": [
                    models.Index(
                        fields=["trip", "expires_at"], name="bookings_seatlock_trip_exp_idx"
                    ),
                    models.Index(
                        fields=["customer", "trip"], name="bookings_seatlock_customer_idx"
                    ),
                    models.Index(fields=["expires_at"], name="bookings_seatlock_expiry_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("trip", "seat_number"), name="bookings_seatlock_seat_unique"
                    ),
                ],
            },
        ),
    ]
