import re

from django.core.exceptions import ValidationError

REGISTRATION_ERROR = "Enter a Sri Lankan registration number, e.g. NB-1234 or WP NB-1234."

# Optional province prefix, then a letter series (NB, CAB) or a numeric series (65, 250), then
# four digits. Spacing and dashes vary on paperwork ("WP NB-1234", "WP-NB-1234"), so they are
# normalised away. A dash after the province only counts before a letter series, so "NB-12345"
# isn't misread as province NB + series 1.
_REGISTRATION = re.compile(
    r"(?:(?P<province>[A-Z]{2})(?: |-(?=[A-Z])))?"
    r"(?P<series>[A-Z]{1,3}|\d{1,3}) ?-? ?(?P<number>\d{4})"
)


def normalize_registration_number(value: str) -> str:
    """Canonical plate: "wp nb 1234" / "WP-NB-1234" -> "WP NB-1234", "nb1234" -> "NB-1234"."""
    compact = " ".join((value or "").upper().replace("–", "-").replace("—", "-").split())
    match = _REGISTRATION.fullmatch(compact)
    if not match:
        raise ValidationError(REGISTRATION_ERROR, code="invalid_registration")
    province = f"{match['province']} " if match["province"] else ""
    return f"{province}{match['series']}-{match['number']}"


def registration_core(canonical: str) -> str:
    """The plate without its optional province prefix ("WP NB-1234" -> "NB-1234")."""
    return canonical.rsplit(" ", 1)[-1]


def validate_registration_number(value: str) -> None:
    normalize_registration_number(value)
