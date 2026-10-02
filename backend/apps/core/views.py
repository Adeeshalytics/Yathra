import logging

from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .exceptions import GENERIC_SERVER_ERROR, error_payload

logger = logging.getLogger(__name__)


class LivenessView(APIView):
    """
    Liveness probe: the process is up and serving requests. It deliberately checks nothing
    else — if it failed whenever the database did, an orchestrator would restart every
    healthy API process during a database outage. Readiness is HealthCheckView's job.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    @extend_schema(responses=inline_serializer("Liveness", {"status": serializers.CharField()}))
    def get(self, request, *args, **kwargs):
        return Response({"status": "ok"})


class HealthCheckView(APIView):
    """Readiness probe used by Docker, load balancers and the frontend: are the database
    and the cache reachable, so this process can actually serve traffic?"""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    @extend_schema(
        responses=inline_serializer(
            "HealthCheck",
            {
                "status": serializers.CharField(),
                "version": serializers.CharField(),
                "checks": serializers.DictField(child=serializers.CharField()),
            },
        )
    )
    def get(self, request, *args, **kwargs):
        checks = {"database": _check_database(), "cache": _check_cache()}
        healthy = all(result == "ok" for result in checks.values())
        return Response(
            {
                "status": "ok" if healthy else "degraded",
                "version": request.version,
                "checks": checks,
            },
            status=status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
        )


def _check_database() -> str:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:
        logger.exception("Database health check failed")
        return "error"
    return "ok"


def _check_cache() -> str:
    try:
        cache.set("health:ping", "pong", timeout=5)
        if cache.get("health:ping") != "pong":
            return "error"
    except Exception:
        logger.exception("Cache health check failed")
        return "error"
    return "ok"


def not_found(request, exception=None):
    return JsonResponse(
        error_payload("not_found", "The requested resource was not found."),
        status=status.HTTP_404_NOT_FOUND,
    )


def server_error(request):
    return JsonResponse(
        error_payload("server_error", GENERIC_SERVER_ERROR),
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
