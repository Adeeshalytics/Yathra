"""Shared building blocks for the admin API (/api/v1/admin/...)."""

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin
from apps.audit.models import ActivityAction
from apps.audit.services import log_activity

from .exceptions import Conflict

UUID_LOOKUP_REGEX = r"[0-9a-fA-F-]{36}"


def changed_fields(serializer) -> list[str]:
    """Model fields whose submitted value differs from what is stored (before saving)."""
    instance = serializer.instance
    changed = []
    for name, value in serializer.validated_data.items():
        current = getattr(instance, name, None)
        if hasattr(current, "all"):  # related managers: nested serializers report their own changes
            continue
        if current != value:
            changed.append(name)
    return changed


class AdminModelViewSet(viewsets.ModelViewSet):
    """
    Base for every admin resource: admin-only, audited and safe to delete.

    - Every create/update/delete writes an ActivityLog entry (shown on the dashboard).
    - Subclasses return a human explanation from `get_delete_blocker()` when a record is
      still in use; the API then answers 409 instead of deleting it.
    - Responses after a write are re-read through `get_queryset()` so annotated counts
      (bus_count, seat_count, ...) are always present.
    """

    permission_classes = [IsAdmin]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    lookup_value_regex = UUID_LOOKUP_REGEX

    def perform_create(self, serializer):
        with transaction.atomic():
            instance = serializer.save()
            log_activity(actor=self.request.user, action=ActivityAction.CREATED, instance=instance)
        serializer.instance = self.reload(instance)

    def perform_update(self, serializer):
        changes = changed_fields(serializer)
        with transaction.atomic():
            instance = serializer.save()
            changes += getattr(serializer, "changed_nested", [])
            if changes:
                log_activity(
                    actor=self.request.user,
                    action=ActivityAction.UPDATED,
                    instance=instance,
                    changes={"fields": sorted(set(changes))},
                )
        serializer.instance = self.reload(instance)

    def perform_destroy(self, instance):
        blocker = self.get_delete_blocker(instance)
        if blocker:
            raise Conflict(blocker)
        entity_type, entity_id, label = instance._meta.model_name, str(instance.pk), str(instance)
        with transaction.atomic():
            instance.delete()
            log_activity(
                actor=self.request.user,
                action=ActivityAction.DELETED,
                entity_type=entity_type,
                entity_id=entity_id,
                entity_label=label,
            )

    def get_delete_blocker(self, instance) -> str | None:
        """Explain why `instance` can't be deleted, or return None if deleting is safe."""
        return None

    def reload(self, instance):
        return self.get_queryset().get(pk=instance.pk)


class ActivationActionsMixin:
    """
    Adds `POST {id}/activate/` and `POST {id}/deactivate/`. Models with a boolean `active`
    field work as-is; others override `is_record_active` / `set_record_active`.
    """

    def is_record_active(self, instance) -> bool:
        return instance.active

    def set_record_active(self, instance, active: bool) -> None:
        instance.active = active
        instance.save(update_fields=["active", "updated_at"])

    @extend_schema(request=None, summary="Activate")
    @action(detail=True, methods=["post"])
    def activate(self, request, *args, **kwargs):
        return self._set_active(True)

    @extend_schema(request=None, summary="Deactivate")
    @action(detail=True, methods=["post"])
    def deactivate(self, request, *args, **kwargs):
        return self._set_active(False)

    def _set_active(self, active: bool) -> Response:
        instance = self.get_object()
        if self.is_record_active(instance) != active:
            with transaction.atomic():
                self.set_record_active(instance, active)
                log_activity(
                    actor=self.request.user,
                    action=ActivityAction.ACTIVATED if active else ActivityAction.DEACTIVATED,
                    instance=instance,
                )
        return Response(self.get_serializer(self.reload(instance)).data)
