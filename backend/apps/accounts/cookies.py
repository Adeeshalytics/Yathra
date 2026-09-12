"""The refresh token travels only in an HttpOnly cookie, never in JavaScript-readable storage."""

from django.conf import settings
from rest_framework.request import Request
from rest_framework.response import Response


def _config() -> dict:
    return settings.JWT_REFRESH_COOKIE


def set_refresh_cookie(response: Response, refresh_token: str) -> None:
    config = _config()
    response.set_cookie(
        config["NAME"],
        refresh_token,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        path=config["PATH"],
        domain=config["DOMAIN"],
        secure=config["SECURE"],
        httponly=True,
        samesite=config["SAMESITE"],
    )


def clear_refresh_cookie(response: Response) -> None:
    config = _config()
    response.delete_cookie(
        config["NAME"], path=config["PATH"], domain=config["DOMAIN"], samesite=config["SAMESITE"]
    )


def get_refresh_token(request: Request) -> str | None:
    """Browsers send the cookie; non-browser clients may post {"refresh": "..."} instead."""
    token = request.COOKIES.get(_config()["NAME"])
    if token:
        return token
    body_token = request.data.get("refresh") if hasattr(request.data, "get") else None
    return body_token if isinstance(body_token, str) and body_token else None
