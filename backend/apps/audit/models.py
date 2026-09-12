import uuid

from django.conf import settings
from django.db import models


class ActivityAction(models.TextChoices):
    CREATED = "created", "Created"
    UPDATED = "updated", "Updated"
    DELETED = "deleted", "Deleted"
    ACTIVATED = "activated", "Activated"
    DEACTIVATED = "deactivated", "Deactivated"
    CANCELLED = "cancelled", "Cancelled"
    STATUS_CHANGED = "status_changed", "Status changed"
    GENERATED = "generated", "Generated trips"
    REFUNDED = "refunded", "Refunded"


class ActivityLog(models.Model):
    """
    Append-only record of administrative changes. Entities are referenced loosely
    (type + id + label snapshot) so the history survives when the record is deleted.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activity",
    )
    actor_email = models.EmailField(max_length=254, blank=True)
    action = models.CharField(max_length=16, choices=ActivityAction.choices)
    entity_type = models.CharField(max_length=40)
    entity_id = models.CharField(max_length=64)
    entity_label = models.CharField(max_length=255)
    changes = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"], name="audit_log_recent_idx"),
            models.Index(fields=["entity_type", "entity_id"], name="audit_log_entity_idx"),
        ]

    def __str__(self) -> str:
        return (
            f"{self.actor_email or 'system'} {self.action} {self.entity_type} {self.entity_label}"
        )
