import secrets
from datetime import timedelta

from django.db import migrations

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def backfill_trips(apps, schema_editor):
    """
    Step 2 of 3: give existing trips a code, their operator (from the bus), an estimated
    arrival and their own stop timetable (from the route's offsets).
    """
    Trip = apps.get_model("trips", "Trip")
    TripStop = apps.get_model("trips", "TripStop")
    RouteStop = apps.get_model("routes", "RouteStop")
    Bus = apps.get_model("fleet", "Bus")

    operator_of_bus = dict(Bus.objects.values_list("id", "operator_id"))
    timetables: dict = {}
    used_codes: set[str] = set()

    for trip in Trip.objects.order_by("departure_datetime"):
        if trip.route_id not in timetables:
            timetables[trip.route_id] = list(
                RouteStop.objects.filter(route_id=trip.route_id).order_by("sequence")
            )
        route_stops = timetables[trip.route_id]

        code = ""
        while not code or code in used_codes:
            code = "TR" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        used_codes.add(code)

        journey = route_stops[-1].arrival_offset if route_stops else timedelta(0)
        trip.code = code
        trip.operator_id = operator_of_bus[trip.bus_id]
        trip.estimated_arrival_datetime = trip.departure_datetime + (
            journey if journey > timedelta(0) else timedelta(hours=1)
        )
        trip.save(update_fields=["code", "operator", "estimated_arrival_datetime"])

        TripStop.objects.bulk_create(
            TripStop(
                trip_id=trip.id,
                stop_id=route_stop.stop_id,
                sequence=route_stop.sequence,
                arrival_datetime=trip.departure_datetime + route_stop.arrival_offset,
                departure_datetime=trip.departure_datetime + route_stop.departure_offset,
                is_boarding_point=route_stop.is_boarding_point,
                is_dropoff_point=route_stop.is_dropoff_point,
            )
            for route_stop in route_stops
        )


class Migration(migrations.Migration):
    dependencies = [
        ("fleet", "0002_seat_layouts_and_bus_facilities"),
        ("routes", "0002_route_base_fare_and_case_insensitive_stops"),
        ("trips", "0002_trip_schedules_and_stop_timings"),
    ]

    operations = [migrations.RunPython(backfill_trips, migrations.RunPython.noop)]
