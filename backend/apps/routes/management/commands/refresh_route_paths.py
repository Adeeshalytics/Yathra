"""
Fetch the road each route drives and store it.

Routes lose their stored path whenever their stops (or a stop's coordinates) change, and a
route created while the routing service was down never had one. This command fills the gaps —
run it after seeding, and on a timer if stops are edited often.
"""

from django.core.management.base import BaseCommand, CommandError

from apps.routes import routing
from apps.routes.models import Route
from apps.routes.services import refresh_route_path, route_coordinates


class Command(BaseCommand):
    help = "Work out the road route between each route's stops and cache it on the route."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-fetch every route, not only the ones with no stored path.",
        )
        parser.add_argument("--route", help="Only this route id.")

    def handle(self, *args, **options):
        if not routing.is_configured():
            raise CommandError(
                "No routing service configured. Set ROUTING_SERVICE_URL (see docs/route-maps.md)."
            )

        routes = Route.objects.all().order_by("name")
        if options["route"]:
            routes = routes.filter(pk=options["route"])
        if not options["force"]:
            routes = routes.filter(path="")

        done = skipped = failed = 0
        for route in routes:
            if len(route_coordinates(route)) < 2:
                self.stdout.write(f"  skip  {route.name} — fewer than two mapped stops")
                skipped += 1
                continue
            if refresh_route_path(route):
                route.refresh_from_db(fields=["path_distance_m", "path_duration_s"])
                kilometres = (route.path_distance_m or 0) / 1000
                self.stdout.write(self.style.SUCCESS(f"  ok    {route.name} — {kilometres:.1f} km"))
                done += 1
            else:
                self.stdout.write(self.style.WARNING(f"  fail  {route.name}"))
                failed += 1

        self.stdout.write(f"\n{done} mapped, {skipped} skipped, {failed} failed.")
