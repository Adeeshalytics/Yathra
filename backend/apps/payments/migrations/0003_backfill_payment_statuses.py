"""Rename payment statuses to the new set and keep at most one open attempt per booking."""

from django.db import migrations

RENAMED = {"initiated": "pending", "succeeded": "successful"}
OPEN = ("pending", "processing")


def forwards(apps, schema_editor):
    Payment = apps.get_model("payments", "Payment")
    for old, new in RENAMED.items():
        Payment.objects.filter(status=old).update(status=new)
    seen = set()
    for payment in Payment.objects.filter(status__in=OPEN).order_by("booking_id", "-created_at"):
        if payment.booking_id in seen:
            payment.status = "cancelled"
            payment.failure_reason = "Replaced by a newer payment attempt."
            payment.save(update_fields=["status", "failure_reason"])
        seen.add(payment.booking_id)


def backwards(apps, schema_editor):
    Payment = apps.get_model("payments", "Payment")
    for old, new in RENAMED.items():
        Payment.objects.filter(status=new).update(status=old)


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0002_payment_gateways'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
