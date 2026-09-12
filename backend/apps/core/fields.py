from django.db import models

from .validators import normalize_phone_number


class PhoneNumberField(models.CharField):
    """CharField that stores phone numbers in E.164 form (e.g. +94771234567)."""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("max_length", 16)
        super().__init__(*args, **kwargs)

    def to_python(self, value):
        value = super().to_python(value)
        if value in (None, ""):
            return value
        return normalize_phone_number(value)
