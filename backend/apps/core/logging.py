"""
Logging helpers: request-scoped context, a JSON formatter for production log shipping, and
`log_event` for the business events an operator needs to be able to trace after the fact.
"""

import contextvars
import json
import logging
from datetime import UTC, datetime

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

# Attributes every LogRecord has; anything else was passed through `extra=`.
_STANDARD_ATTRS = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {
    "message",
    "asctime",
    "request_id",
}


class RequestContextFilter(logging.Filter):
    """Stamp every record with the id of the request being processed (or "-")."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", request_id_var.get()),
        }
        payload.update(
            {
                key: value
                for key, value in record.__dict__.items()
                if key not in _STANDARD_ATTRS and not key.startswith("_")
            }
        )
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def client_ip(request) -> str:
    """
    The caller's address for security logs, worked out the same way as for rate limiting:
    behind N trusted proxies it is entry -N of X-Forwarded-For (the one the outermost trusted
    proxy appended). Entries further left come from the client and can be forged.
    """
    from django.conf import settings

    proxies = getattr(settings, "TRUSTED_PROXY_COUNT", 0)
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if proxies > 0 and forwarded:
        addresses = forwarded.split(",")
        return addresses[-min(proxies, len(addresses))].strip()[:45]
    return (request.META.get("REMOTE_ADDR") or "")[:45]


# Business events all share one logger, so a deployment can route or sample them separately.
EVENT_LOGGER = "apps.events"


def log_event(event: str, /, *, level: int = logging.INFO, **fields) -> None:
    """
    Record one business event — a sign-in, a seat lock, a booking, a payment, a refund.

    `event` is a stable dotted name ("booking.created") and is positional so that a field may
    be called `name`; `fields` become top-level keys in the JSON log, and any that would collide
    with logging own attributes are dropped rather than blowing up at the call site. Values are
    rendered by the formatter, so ids can be passed as they are.
    """
    from .metrics import EVENTS

    safe = {key: value for key, value in fields.items() if key not in _STANDARD_ATTRS}
    logging.getLogger(EVENT_LOGGER).log(level, event, extra={"event": event, **safe})
    # Event names are a fixed set written in the code, so they are safe as a metric label.
    EVENTS.labels(event=event).inc()
