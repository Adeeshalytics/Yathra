from apps.core.logging import log_event

from .models import ActivityLog


def log_activity(
    *,
    actor,
    action: str,
    instance=None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    entity_label: str | None = None,
    changes: dict | None = None,
) -> ActivityLog:
    """Record an admin action. Pass a model `instance`, or the entity fields for deleted records."""
    if instance is not None:
        entity_type = entity_type or instance._meta.model_name
        entity_id = str(instance.pk)
        entity_label = str(instance)
    user = actor if getattr(actor, "is_authenticated", False) else None
    log_event(
        "admin.action",
        action=action,
        actor_id=str(user.pk) if user else None,
        actor_email=getattr(user, "email", "") or "",
        entity_type=entity_type or "",
        entity_id=entity_id or "",
        changed=sorted(changes or {}),
    )
    return ActivityLog.objects.create(
        actor=user,
        actor_email=getattr(user, "email", "") or "",
        action=action,
        entity_type=entity_type or "",
        entity_id=entity_id or "",
        entity_label=(entity_label or "")[:255],
        changes=changes or {},
    )
