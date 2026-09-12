from rest_framework.viewsets import ReadOnlyModelViewSet

from apps.accounts.permissions import IsAdmin
from apps.core.admin_viewsets import UUID_LOOKUP_REGEX

from .models import ActivityLog
from .serializers import ActivityLogSerializer


class ActivityLogViewSet(ReadOnlyModelViewSet):
    """Admin change history, newest first."""

    permission_classes = [IsAdmin]
    serializer_class = ActivityLogSerializer
    queryset = ActivityLog.objects.all()
    lookup_value_regex = UUID_LOOKUP_REGEX
    filterset_fields = ["entity_type", "entity_id", "action"]
    search_fields = ["entity_label", "actor_email"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]
