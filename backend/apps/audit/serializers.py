from rest_framework import serializers

from .models import ActivityLog


class ActivityLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityLog
        fields = [
            "id",
            "actor_email",
            "action",
            "entity_type",
            "entity_id",
            "entity_label",
            "changes",
            "created_at",
        ]
        read_only_fields = fields
