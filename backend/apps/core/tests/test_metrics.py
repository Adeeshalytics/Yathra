"""The Prometheus endpoint: what it exposes, and who may read it."""

import pytest

from apps.core.logging import log_event

pytestmark = pytest.mark.django_db


def scrape(api_client, **extra):
    return api_client.get("/metrics", REMOTE_ADDR=extra.pop("remote", "10.42.0.7"), **extra)


def test_prometheus_inside_the_cluster_can_scrape(api_client):
    api_client.get("/api/v1/health/live/")

    response = scrape(api_client)

    assert response.status_code == 200
    body = response.content.decode()
    # django-prometheus' request metrics …
    assert "django_http_requests_total_by_method_total" in body
    assert "django_http_requests_latency_seconds_by_view_method_bucket" in body


def test_business_events_are_counted_by_name(api_client):
    log_event("booking.created", booking_id="b1")
    log_event("booking.created", booking_id="b2")

    body = scrape(api_client).content.decode()

    line = next(
        line
        for line in body.splitlines()
        if line.startswith('yathra_events_total{event="booking.created"}')
    )
    assert float(line.split()[-1]) >= 2


@pytest.mark.parametrize(
    ("remote", "headers"),
    [
        # Through a reverse proxy: the ingress (or any proxy) adds X-Forwarded-For.
        ("10.42.0.3", {"HTTP_X_FORWARDED_FOR": "203.0.113.9"}),
        # Straight from the internet. (Not a documentation range such as 203.0.113.0/24:
        # Python counts those as private, which is harmless, as they are never routed.)
        ("8.8.8.8", {}),
    ],
)
def test_the_endpoint_does_not_exist_for_anyone_else(api_client, remote, headers):
    assert scrape(api_client, remote=remote, **headers).status_code == 404
