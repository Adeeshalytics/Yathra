"""Give every ticket its own link: a random share code, unique across tickets."""

import secrets

from django.db import migrations, models

import apps.tickets.models


def forwards(apps, schema_editor):
    Ticket = apps.get_model("tickets", "Ticket")
    for ticket in Ticket.objects.filter(share_code__isnull=True).only("pk").iterator():
        Ticket.objects.filter(pk=ticket.pk).update(share_code=secrets.token_urlsafe(16))


class Migration(migrations.Migration):

    dependencies = [
        ("tickets", "0002_backfill_tickets"),
    ]

    operations = [
        migrations.AddField(
            model_name="ticket",
            name="share_code",
            field=models.CharField(editable=False, max_length=32, null=True),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="ticket",
            name="share_code",
            field=models.CharField(
                default=apps.tickets.models.generate_share_code, editable=False, max_length=32
            ),
        ),
        migrations.AddConstraint(
            model_name="ticket",
            constraint=models.UniqueConstraint(
                fields=("share_code",), name="tickets_ticket_share_code_unique"
            ),
        ),
    ]
