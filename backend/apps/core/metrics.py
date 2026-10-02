"""
Prometheus metrics: the business events counter and the /metrics endpoint.

Request, response and latency metrics come from django-prometheus' middleware. On top of that,
every business event the app already logs (apps.core.logging.log_event — booking.created,
payment.captured, auth.login_failed, …) is counted here, so dashboards and alerts can follow
bookings and payments without a second set of instrumentation calls.
"""

import ipaddress

from django.http import Http404
from django_prometheus.exports import ExportToDjangoView
from prometheus_client import Counter

EVENTS = Counter(
    "yathra_events",
    "Business events recorded with log_event, by event name.",
    ["event"],
)


def _is_private(address: str) -> bool:
    try:
        return ipaddress.ip_address(address).is_private
    except ValueError:
        return False


def metrics(request):
    """
    The Prometheus scrape endpoint. It answers only direct requests from a private address —
    Prometheus inside the cluster — and pretends not to exist for anything that came through a
    reverse proxy (which adds X-Forwarded-For), so it stays internal however the site is routed.
    """
    if request.headers.get("X-Forwarded-For") or not _is_private(
        request.META.get("REMOTE_ADDR", "")
    ):
        raise Http404
    return ExportToDjangoView(request)
