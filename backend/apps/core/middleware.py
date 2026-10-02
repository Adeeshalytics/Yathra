import logging
import re
import time
import uuid

from .logging import request_id_var

logger = logging.getLogger("apps.core.request")

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,128}$")
_QUIET_PATHS = ("/api/v1/health/", "/api/v1/health/live/")


class RequestContextMiddleware:
    """
    Give every request an id (reusing a sane incoming X-Request-ID from a proxy),
    expose it on the response and in every log line, and log one summary line per request.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming if _VALID_REQUEST_ID.match(incoming) else uuid.uuid4().hex
        request.request_id = request_id
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        try:
            response = self.get_response(request)
            response[REQUEST_ID_HEADER] = request_id
            self._log(request, response.status_code, (time.perf_counter() - started) * 1000)
            return response
        finally:
            request_id_var.reset(token)

    @staticmethod
    def _log(request, status_code: int, duration_ms: float) -> None:
        if status_code >= 500:
            level = logging.ERROR
        elif status_code >= 400:
            level = logging.WARNING
        elif request.path in _QUIET_PATHS:
            level = logging.DEBUG
        else:
            level = logging.INFO

        user = getattr(request, "user", None)
        user_id = str(user.pk) if user is not None and user.is_authenticated else None
        logger.log(
            level,
            "%s %s -> %s (%.1fms)",
            request.method,
            request.path,
            status_code,
            duration_ms,
            extra={
                "http_method": request.method,
                "path": request.path,
                "status_code": status_code,
                "duration_ms": round(duration_ms, 1),
                "user_id": user_id,
            },
        )
