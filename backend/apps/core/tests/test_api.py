import pytest

pytestmark = pytest.mark.django_db


def test_health_check_reports_ok(api_client):
    response = api_client.get("/api/v1/health/")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "version": "v1",
        "checks": {"database": "ok", "cache": "ok"},
    }


def test_liveness_reports_ok(api_client):
    response = api_client.get("/api/v1/health/live/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_liveness_stays_up_when_the_database_is_down(api_client, monkeypatch):
    # Readiness fails during a database outage; liveness must not, or every API process
    # would be restarted at once.
    monkeypatch.setattr("apps.core.views._check_database", lambda: "error")

    assert api_client.get("/api/v1/health/").status_code == 503
    assert api_client.get("/api/v1/health/live/").status_code == 200


def test_every_response_carries_a_request_id(api_client):
    response = api_client.get("/api/v1/health/")
    assert len(response["X-Request-ID"]) >= 8


def test_sane_incoming_request_id_is_propagated(api_client):
    response = api_client.get("/api/v1/health/", HTTP_X_REQUEST_ID="lb-trace-12345678")
    assert response["X-Request-ID"] == "lb-trace-12345678"


def test_unknown_api_version_is_not_routed(api_client):
    response = api_client.get("/api/v2/health/")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_errors_use_the_standard_envelope(api_client):
    response = api_client.get("/api/v1/auth/me/")

    assert response.status_code == 401
    error = response.json()["error"]
    assert error["code"] == "not_authenticated"
    assert error["message"]
    assert error["request_id"] == response["X-Request-ID"]


class TestPublicReferenceDataIsCacheable:
    """Stops and routes rarely change and are the same for everyone, so proxies may keep them."""

    @pytest.mark.parametrize("path", ["/api/v1/stops/", "/api/v1/routes/"])
    def test_a_signed_out_visitor_gets_a_shared_cache_header(self, api_client, path):
        response = api_client.get(path)

        assert response.status_code == 200
        assert "public" in response["Cache-Control"]
        assert "max-age=300" in response["Cache-Control"]
        assert "stale-while-revalidate" in response["Cache-Control"]

    def test_a_signed_in_visitor_is_never_cached(self, api_client, customer):
        api_client.force_authenticate(customer)

        response = api_client.get("/api/v1/stops/")

        assert response.status_code == 200
        assert response["Cache-Control"] == "no-store"

    @pytest.mark.parametrize(
        "path", ["/api/v1/trips/search/?from=Colombo&to=Kandy", "/api/v1/bookings/"]
    )
    def test_anything_that_changes_is_not_cached(self, api_client, customer, path):
        api_client.force_authenticate(customer)

        response = api_client.get(path)

        assert "public" not in response.get("Cache-Control", "")
