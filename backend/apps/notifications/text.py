"""
Small helpers for writing text messages.

An SMS is billed per part. Plain GSM-7 text fits 160 characters in one part (153 per part after
that), but a single character outside that alphabet — an en dash in "Colombo – Kandy", a curly
apostrophe — silently turns the whole message into UCS-2, where a part holds only 70. So messages
are passed through `sms_safe` first, which swaps typographic punctuation for its plain twin.
"""

from datetime import datetime

from django.utils import timezone

GSM_BASIC = frozenset(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?"
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
# Allowed, but each costs two characters.
GSM_EXTENDED = frozenset("^{}\\[~]|€")

REPLACEMENTS = {
    "\u2013": "-",  # en dash
    "\u2014": "-",  # em dash
    "\u2012": "-",  # figure dash
    "\u2212": "-",  # minus sign
    "\u2018": "'",  # left single quote
    "\u2019": "'",  # right single quote / apostrophe
    "\u201a": "'",  # low single quote
    "\u201c": '"',  # left double quote
    "\u201d": '"',  # right double quote
    "\u201e": '"',  # low double quote
    "\u2026": "...",  # ellipsis
    "\u2192": "to",  # rightwards arrow
    "\u00a0": " ",  # no-break space
    "\u2022": "-",  # bullet
    "\u00b7": "-",  # middle dot
}


def sms_safe(text: str) -> str:
    """Replace typographic punctuation that would force a message out of GSM-7."""
    return "".join(REPLACEMENTS.get(char, char) for char in text)


def is_gsm(text: str) -> bool:
    return all(char in GSM_BASIC or char in GSM_EXTENDED for char in text)


def sms_length(text: str) -> int:
    """Characters as the network counts them."""
    if not is_gsm(text):
        return len(text)
    return sum(2 if char in GSM_EXTENDED else 1 for char in text)


def sms_parts(text: str) -> int:
    """How many billable parts a message takes."""
    length = sms_length(text)
    single, multi = (160, 153) if is_gsm(text) else (70, 67)
    if length <= single:
        return 1
    return -(-length // multi)


def mask_phone(phone: str) -> str:
    """+94771234567 → +9477*****67: enough to recognise in a log, not enough to dial."""
    phone = phone or ""
    if len(phone) <= 6:
        return "*" * len(phone)
    return f"{phone[:5]}{'*' * (len(phone) - 7)}{phone[-2:]}"


def mask_email(email: str) -> str:
    local, _, domain = (email or "").partition("@")
    if not domain:
        return "***"
    return f"{local[:1]}***@{domain}"


def mask_recipient(recipient: str) -> str:
    return mask_email(recipient) if "@" in recipient else mask_phone(recipient)


def _local(value: datetime) -> datetime:
    return timezone.localtime(value)


def short_date(value: datetime) -> str:
    """Sat 14 Sep"""
    local = _local(value)
    return f"{local:%a} {local.day} {local:%b}"


def clock(value: datetime) -> str:
    """7:30 AM"""
    return _local(value).strftime("%I:%M %p").lstrip("0")


def day_phrase(value: datetime, now: datetime | None = None) -> str:
    """ "today", "tomorrow" or "on Sat 14 Sep", from the point of view of Sri Lanka."""
    day = _local(value).date()
    today = _local(now or timezone.now()).date()
    if day == today:
        return "today"
    if (day - today).days == 1:
        return "tomorrow"
    return f"on {short_date(value)}"


def seat_phrase(seats: list[str]) -> str:
    return f"{'Seat' if len(seats) == 1 else 'Seats'} {', '.join(seats)}"
