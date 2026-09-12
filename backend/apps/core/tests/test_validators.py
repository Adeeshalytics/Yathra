import pytest
from django.core.exceptions import ValidationError

from apps.core.validators import normalize_phone_number


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("0771234567", "+94771234567"),
        ("077 123 4567", "+94771234567"),
        ("077-123-4567", "+94771234567"),
        ("771234567", "+94771234567"),
        ("94771234567", "+94771234567"),
        ("+94 77 123 4567", "+94771234567"),
        ("0094771234567", "+94771234567"),
        ("0112345678", "+94112345678"),
        ("+44 20 7946 0958", "+442079460958"),
        ("", ""),
    ],
)
def test_normalizes_valid_numbers(raw, expected):
    assert normalize_phone_number(raw) == expected


@pytest.mark.parametrize(
    "raw", ["12345", "077123456", "07712345678", "+94 07 123 4567", "abc", "+1"]
)
def test_rejects_invalid_numbers(raw):
    with pytest.raises(ValidationError):
        normalize_phone_number(raw)
