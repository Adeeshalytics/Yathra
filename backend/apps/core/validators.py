import re

from django.core.exceptions import ValidationError

PHONE_ERROR_MESSAGE = "Enter a valid phone number, e.g. 077 123 4567 or +94 77 123 4567."
_SEPARATORS = re.compile(r"[\s\-().]")


def normalize_phone_number(value: str) -> str:
    """
    Normalise a phone number to E.164.

    Sri Lankan numbers are accepted in local (0771234567), national (771234567) or
    international (+94 77 123 4567 / 0094...) form. Other countries must use the
    international "+" form so the country code is unambiguous.
    """
    raw = _SEPARATORS.sub("", value or "")
    if not raw:
        return ""
    if raw.startswith("00"):
        raw = f"+{raw[2:]}"

    if raw.startswith("+"):
        digits = raw[1:]
        if not digits.isdigit():
            raise ValidationError(PHONE_ERROR_MESSAGE, code="invalid_phone")
        if digits.startswith("94"):
            return _sri_lankan(digits[2:])
        if not 8 <= len(digits) <= 15:
            raise ValidationError(PHONE_ERROR_MESSAGE, code="invalid_phone")
        return f"+{digits}"

    if not raw.isdigit():
        raise ValidationError(PHONE_ERROR_MESSAGE, code="invalid_phone")
    if raw.startswith("94") and len(raw) == 11:
        return _sri_lankan(raw[2:])
    if raw.startswith("0") and len(raw) == 10:
        return _sri_lankan(raw[1:])
    if len(raw) == 9:
        return _sri_lankan(raw)
    raise ValidationError(PHONE_ERROR_MESSAGE, code="invalid_phone")


def _sri_lankan(national: str) -> str:
    if len(national) != 9 or national[0] == "0":
        raise ValidationError(PHONE_ERROR_MESSAGE, code="invalid_phone")
    return f"+94{national}"
