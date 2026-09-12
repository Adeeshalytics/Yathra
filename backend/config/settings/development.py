"""Local development settings."""

from .base import *  # noqa: F403
from .base import JWT_REFRESH_COOKIE, REST_FRAMEWORK, env

DEBUG = env.bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1", "0.0.0.0"])

CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=["http://localhost:3000", "http://127.0.0.1:3000"],
)
CSRF_TRUSTED_ORIGINS = env.list(
    "CSRF_TRUSTED_ORIGINS",
    default=["http://localhost:3000", "http://127.0.0.1:3000"],
)

# Browsers drop Secure cookies on plain http://localhost, so relax it for local work.
JWT_REFRESH_COOKIE = {
    **JWT_REFRESH_COOKIE,
    "SECURE": env.bool("JWT_REFRESH_COOKIE_SECURE", default=False),
}

API_DOCS_ENABLED = env.bool("API_DOCS_ENABLED", default=True)

REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_RENDERER_CLASSES": (
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ),
}
