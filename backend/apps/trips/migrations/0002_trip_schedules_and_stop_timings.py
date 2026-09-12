import uuid

import django.contrib.postgres.fields
import django.db.models.deletion
from django.contrib.postgres.operations import BtreeGistExtension
from django.db import migrations, models


class Migration(migrations.Migration):
    """Step 1 of 3: new tables and (temporarily nullable) trip columns."""

    dependencies = [
        ("fleet", "0002_seat_layouts_and_bus_facilities"),
        ("operators", "0001_initial"),
        ("routes", "0002_route_base_fare_and_case_insensitive_stops"),
        ("trips", "0001_initial"),
    ]

    operations = [
        # Needed for "bus = bus" inside the GiST exclusion constraint added in 0004.
        BtreeGistExtension(),
        migrations.CreateModel(
            name="TripSchedule",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "departure_time",
                    models.TimeField(help_text="Sri Lanka time the bus leaves the origin."),
                ),
                (
                    "base_price",
                    models.DecimalField(
                        decimal_places=2, help_text="Ticket price per seat (LKR).", max_digits=10
                    ),
                ),
                (
                    "recurrence",
                    models.CharField(
                        choices=[("daily", "Daily"), ("weekly", "Selected weekdays")],
                        default="daily",
                        max_length=8,
                    ),
                ),
                (
                    "weekdays",
                    django.contrib.postgres.fields.ArrayField(
                        base_field=models.PositiveSmallIntegerField(),
                        blank=True,
                        default=list,
                        help_text="0 = Monday … 6 = Sunday (for selected-weekday schedules).",
                        size=None,
                    ),
                ),
                ("start_date", models.DateField()),
                ("end_date", models.DateField(blank=True, null=True)),
                ("active", models.BooleanField(default=True)),
                ("last_generated_until", models.DateField(blank=True, null=True)),
                (
                    "bus",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="schedules",
                        to="fleet.bus",
                    ),
                ),
                (
                    "operator",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="trip_schedules",
                        to="operators.operator",
                    ),
                ),
                (
                    "route",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="schedules",
                        to="routes.route",
                    ),
                ),
            ],
            options={
                "ordering": ["route__name", "departure_time"],
                "indexes": [
                    models.Index(fields=["bus", "active"], name="trips_sched_bus_active_idx"),
                    models.Index(
                        fields=["route", "active"], name="trips_sched_route_active_idx"
                    ),
                ],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("base_price__gte", 0)),
                        name="trips_schedule_price_non_negative",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("recurrence__in", ["daily", "weekly"])),
                        name="trips_schedule_recurrence_valid",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("end_date__isnull", True),
                            ("end_date__gte", models.F("start_date")),
                            _connector="OR",
                        ),
                        name="trips_schedule_dates_ordered",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("weekdays__contained_by", [0, 1, 2, 3, 4, 5, 6])),
                        name="trips_schedule_weekdays_valid",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            models.Q(("recurrence", "weekly"), _negated=True),
                            ("weekdays__len__gt", 0),
                            _connector="OR",
                        ),
                        name="trips_schedule_weekly_has_days",
                    ),
                ],
            },
        ),
        # Superseded by the overlap exclusion constraint (added in 0004), which also frees the
        # slot when a trip is cancelled.
        migrations.RemoveConstraint(model_name="trip", name="trips_trip_bus_departure_unique"),
        migrations.AddField(
            model_name="trip",
            name="code",
            field=models.CharField(editable=False, max_length=12, null=True),
        ),
        migrations.AddField(
            model_name="trip",
            name="operator",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="trips",
                to="operators.operator",
            ),
        ),
        migrations.AddField(
            model_name="trip",
            name="estimated_arrival_datetime",
            field=models.DateTimeField(null=True),
        ),
        migrations.AddField(
            model_name="trip",
            name="active",
            field=models.BooleanField(default=True, help_text="Inactive trips are hidden from sale."),
        ),
        migrations.AddField(
            model_name="trip",
            name="cancellation_reason",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="trip",
            name="cancelled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="trip",
            name="schedule",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="trips",
                to="trips.tripschedule",
            ),
        ),
        migrations.CreateModel(
            name="TripStop",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("sequence", models.PositiveSmallIntegerField()),
                ("arrival_datetime", models.DateTimeField()),
                ("departure_datetime", models.DateTimeField()),
                ("is_boarding_point", models.BooleanField(default=True)),
                ("is_dropoff_point", models.BooleanField(default=True)),
                (
                    "stop",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="trip_stops",
                        to="routes.stop",
                    ),
                ),
                (
                    "trip",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="trip_stops",
                        to="trips.trip",
                    ),
                ),
            ],
            options={
                "ordering": ["trip", "sequence"],
                "indexes": [
                    models.Index(
                        fields=["stop", "departure_datetime"], name="trips_tripstop_stop_dep_idx"
                    ),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("trip", "sequence"), name="trips_tripstop_sequence_unique"
                    ),
                    models.UniqueConstraint(
                        fields=("trip", "stop"), name="trips_tripstop_stop_unique"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("departure_datetime__gte", models.F("arrival_datetime"))),
                        name="trips_tripstop_departs_after_arrival",
                    ),
                ],
            },
        ),
    ]
