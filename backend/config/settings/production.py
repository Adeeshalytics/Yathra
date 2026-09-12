"""Production settings. Every value that differs per deployment comes from the environment."""

from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .base import MIDDLEWARE, PAYMENT_PROVIDERS, STORAGES, env

DEBUG = False
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")

# The built-in test gateway confirms bookings without taking money.
if "mock" in PAYMENT_PROVIDERS and not env.bool("ALLOW_MOCK_PAYMENTS", default=False):
    raise ImproperlyConfigured(
        "PAYMENT_PROVIDERS includes the test gateway 'mock'. Remove it in production "
        "(or set ALLOW_MOCK_PAYMENTS=true for a staging site)."
    )

# WhiteNoise serves the collected static files (Django admin assets) straight from gunicorn.
MIDDLEWARE = [
    MIDDLEWARE[0],  # SecurityMiddleware must stay first
    "whitenoise.middleware.WhiteNoiseMiddleware",
    *MIDDLEWARE[1:],
]

# Behind a TLS-terminating proxy / load balancer.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env.bool("DJANGO_SECURE_SSL_REDIRECT", default=True)
# Health checks from the load balancer usually arrive over plain HTTP.
SECURE_REDIRECT_EXEMPT = [r"^api/v1/health/$"]

SECURE_HSTS_SECONDS = env.int("DJANGO_SECURE_HSTS_SECONDS", default=60 * 60 * 24 * 30)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", default=True)
SECURE_HSTS_PRELOAD = env.bool("DJANGO_SECURE_HSTS_PRELOAD", default=False)
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

STORAGES = {
    **STORAGES,
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
