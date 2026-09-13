"""
Uniform error responses.

Every API error has the same shape so clients can handle it generically:

    {
      "error": {
        "code": "validation_error",
        "message": "Please correct the highlighted fields.",
        "details": {"email": ["A user with this email already exists."]},
        "request_id": "3f2a..."
      }
    }
"""

import logging
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import ProtectedError, RestrictedError
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.serializers import as_serializer_error
from rest_framework.views import exception_handler as drf_exception_handler

from .logging import request_id_var

logger = logging.getLogger("apps.core.exceptions")

GENERIC_SERVER_ERROR = "Something went wrong on our side. Please try again shortly."


class Conflict(exceptions.APIException):
    """409: valid request, but it clashes with current state (e.g. deleting a record in use)."""

    status_code = status.HTTP_409_CONFLICT
    default_detail = "This action conflicts with the resource's current state."
    default_code = "conflict"

    def __init__(self, detail=None, code=None, details: Any = None):
        super().__init__(detail, code)
        # Structured context for clients, e.g. {"seats": {"15": "locked"}}.
        self.details = details


class ServiceUnavailable(exceptions.APIException):
    """503: something we depend on (a gateway, the SMS provider) can't be used right now."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "This isn't available right now. Please try again shortly."
    default_code = "service_unavailable"

    def __init__(self, detail=None, code=None, details: Any = None):
        super().__init__(detail, code)
        self.details = details


def error_payload(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "request_id": request_id_var.get(),
        }
    }


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response:
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(as_serializer_error(exc))
    elif isinstance(exc, ProtectedError | RestrictedError):
        exc = Conflict("This record is still used by other records, so it can't be deleted.")
    elif isinstance(exc, IntegrityError):
        # Serializers pre-check uniqueness; this only fires when two requests race.
        logger.warning("Integrity error in API view: %s", exc)
        exc = Conflict("This change clashes with existing data (for example a duplicate value).")

    response = drf_exception_handler(exc, context)
    if response is None:
        # Not an API exception: a genuine bug. Log with traceback, hide internals from the client.
        logger.exception("Unhandled exception in API view", exc_info=exc)
        return Response(
            error_payload("server_error", GENERIC_SERVER_ERROR),
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    code, message, details = _describe(exc, response.data)
    response.data = error_payload(code, message, details)
    return response


def _describe(exc: Exception, data: Any) -> tuple[str, str, Any]:
    if isinstance(exc, exceptions.ValidationError):
        details = data if isinstance(data, dict) else {"non_field_errors": data}
        non_field = details.get("non_field_errors") if isinstance(details, dict) else None
        message = str(non_field[0]) if non_field else "Please correct the highlighted fields."
        return "validation_error", message, details

    if isinstance(exc, exceptions.Throttled):
        return "throttled", "Too many requests. Please slow down.", {"retry_after": exc.wait}

    code = getattr(exc, "default_code", "error")
    message = str(getattr(exc, "default_detail", "Request failed."))
    if isinstance(data, dict) and "detail" in data:
        message = str(data["detail"])
        code = str(data.get("code") or _first_code(exc) or code)
    elif isinstance(exc, exceptions.APIException):
        code = _first_code(exc) or code
    return code, message, getattr(exc, "details", None)


def _first_code(exc: Exception) -> str | None:
    if not isinstance(exc, exceptions.APIException):
        return None
    codes = exc.get_codes()
    if isinstance(codes, str):
        return codes
    if isinstance(codes, dict):
        detail_code = codes.get("detail")
        if isinstance(detail_code, str):
            return detail_code
    return None
