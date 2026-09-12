"""
Release expired seat locks and unpaid bookings.

Seat availability never depends on this command — expired holds stop counting the moment they
expire — but running it every minute (cron, Celery beat, a Kubernetes CronJob…) keeps booking
statuses current and the tables small.

    python manage.py expire_seat_holds
"""

from django.core.management.base import BaseCommand

from apps.bookings.services import release_expired_holds


class Command(BaseCommand):
    help = "Release expired seat locks and mark unpaid bookings whose hold ran out as expired."

    def handle(self, *args, **options):
        locks, bookings = release_expired_holds()
        self.stdout.write(
            f"Released {locks} expired seat lock(s); {bookings} unpaid booking(s) expired."
        )
