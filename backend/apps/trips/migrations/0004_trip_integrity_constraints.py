import django.contrib.postgres.constraints
import django.contrib.postgres.fields.ranges
import django.db.models.deletion
from django.db import migrations, models

import apps.trips.models


class Migration(migrations.Migration):
    """Step 3 of 3: backfilled columns become required; integrity constraints are added."""

    dependencies = [
        ("operators", "0001_initial"),
        ("trips", "0003_backfill_trip_details"),
    ]

    operations = [
        migrations.AlterField(
            model_name="trip",
            name="code",
            field=models.CharField(editable=False, max_length=12),
        ),
        migrations.AlterField(
            model_name="trip",
            name="operator",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="trips",
                to="operators.operator",
            ),
        ),
        migrations.AlterField(
            model_name="trip",
            name="estimated_arrival_datetime",
            field=models.DateTimeField(),
        ),
        migrations.AddIndex(
            model_name="trip",
            index=models.Index(
                fields=["bus", "departure_datetime"], name="trips_trip_bus_departure_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="trip",
            index=models.Index(
                fields=["operator", "departure_datetime"], name="trips_trip_operator_depart_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="trip",
            constraint=models.UniqueConstraint(fields=("code",), name="trips_trip_code_unique"),
        ),
        migrations.AddConstraint(
            model_name="trip",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("estimated_arrival_datetime__gt", models.F("departure_datetime"))
                ),
                name="trips_trip_arrives_after_departure",
            ),
        ),
        migrations.AddConstraint(
            model_name="trip",
            constraint=django.contrib.postgres.constraints.ExclusionConstraint(
                condition=models.Q(("status", "cancelled"), _negated=True),
                expressions=[
                    (
                        apps.trips.models.TsTzRange(
                            "departure_datetime",
                            "estimated_arrival_datetime",
                            django.contrib.postgres.fields.ranges.RangeBoundary(),
                        ),
                        "&&",
                    ),
                    ("bus", "="),
                ],
                name="trips_trip_no_bus_overlap",
            ),
        ),
    ]
