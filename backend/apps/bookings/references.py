import secrets

from django.conf import settings

# No 0/O, 1/I/L: references are read out over the phone and typed from SMS.
REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
REFERENCE_RANDOM_LENGTH = 8


def generate_booking_reference() -> str:
    """Customer-facing reference such as ``YT7KQ2M9XH``. Cryptographically random, not guessable."""
    random_part = "".join(
        secrets.choice(REFERENCE_ALPHABET) for _ in range(REFERENCE_RANDOM_LENGTH)
    )
    return f"{settings.BOOKING_REFERENCE_PREFIX}{random_part}"
