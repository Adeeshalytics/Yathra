from django.core.management.base import BaseCommand

from apps.notifications.models import NotificationStatus
from apps.notifications.services import deliver_due, queue_trip_reminders


class Command(BaseCommand):
    help = (
        "Queue departure reminders that are due, then send every text message and e-mail that "
        "is waiting (including retries). Safe to run as often as you like; run it every minute."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit", type=int, default=500, help="Most messages to send in one run."
        )
        parser.add_argument(
            "--skip-reminders", action="store_true", help="Only send what is already queued."
        )

    def handle(self, *args, limit: int, skip_reminders: bool, **options):
        reminded = 0 if skip_reminders else queue_trip_reminders()
        outcome = deliver_due(limit=limit)
        self.stdout.write(
            f"Reminders queued for {reminded} booking(s). "
            f"Sent {outcome[NotificationStatus.SENT]}, "
            f"retrying {outcome[NotificationStatus.PENDING]}, "
            f"failed {outcome[NotificationStatus.FAILED]}, "
            f"not sent {outcome[NotificationStatus.SKIPPED]}."
        )
