"""Abstract base models shared by every domain app."""

import uuid

from django.db import models


class UUIDPrimaryKeyModel(models.Model):
    """Random UUID primary keys: safe to expose in URLs and not enumerable."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BaseModel(UUIDPrimaryKeyModel, TimeStampedModel):
    class Meta:
        abstract = True
