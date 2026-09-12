from django.core.management.base import BaseCommand

from apps.payments.services import reconcile_open_payments


class Command(BaseCommand):
    help = (
        "Check payment attempts still waiting on their gateway: apply what the gateway reports "
        "(for late or lost notifications) and give up on attempts abandoned long ago. "
        "Run every few minutes from cron, next to expire_seat_holds."
    )

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=200, help="Attempts to check per run.")

    def handle(self, *args, limit: int, **options):
        outcomes = reconcile_open_payments(limit=limit)
        summary = ", ".join(f"{name}: {count}" for name, count in sorted(outcomes.items()))
        checked = sum(outcomes.values())
        self.stdout.write(self.style.SUCCESS(f"Checked {checked} payment(s). {summary}".strip()))
