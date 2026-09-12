from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("audit", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="activitylog",
            name="action",
            field=models.CharField(
                choices=[
                    ("created", "Created"),
                    ("updated", "Updated"),
                    ("deleted", "Deleted"),
                    ("activated", "Activated"),
                    ("deactivated", "Deactivated"),
                    ("cancelled", "Cancelled"),
                    ("status_changed", "Status changed"),
                    ("generated", "Generated trips"),
                ],
                max_length=16,
            ),
        ),
    ]
