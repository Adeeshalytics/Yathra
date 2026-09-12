import pytest
from django.core.exceptions import ValidationError

from apps.fleet.validators import normalize_registration_number, registration_core


@pytest.mark.parametrize(
    ("raw", "canonical"),
    [
        ("nb 1234", "NB-1234"),
        ("NB1234", "NB-1234"),
        ("wp nb-1234", "WP NB-1234"),
        ("WP-NC-4521", "WP NC-4521"),
        ("65 1234", "65-1234"),
        ("CAB–1234", "CAB-1234"),
    ],
)
def test_plates_are_normalised(raw, canonical):
    assert normalize_registration_number(raw) == canonical


@pytest.mark.parametrize("raw", ["HELLO", "NB-12345", "WPX NB-1234", ""])
def test_invalid_plates_are_rejected(raw):
    with pytest.raises(ValidationError):
        normalize_registration_number(raw)


def test_core_drops_the_province():
    assert registration_core("WP NC-4521") == "NC-4521"
