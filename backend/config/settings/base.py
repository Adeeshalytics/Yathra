"""
Settings shared by every environment.

Environment-specific modules (development, production, test) import from here and
override only what differs. Every secret and deployment-specific value is read from
environment variables — nothing sensitive is hard-coded.
"""

from datetime import timedelta
from pathlib import Path

import environ
from corsheaders.defaults import default_headers

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
# Load backend/.env for local (non-Docker) development. Real environment variables win.
environ.Env.read_env(BASE_DIR / ".env", overwrite=False)

# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------
SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])
APP_NAME = env("APP_NAME", default="Yathra")

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
]

LOCAL_APPS = [
    "apps.core",
    "apps.audit",
    "apps.accounts",
    "apps.operators",
    "apps.fleet",
    "apps.routes",
    "apps.trips",
    "apps.bookings",
    "apps.payments",
    "apps.tickets",
    "apps.reports",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "apps.core.middleware.RequestContextMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# Believe X-Forwarded-For when logging the caller's address (only true behind a proxy that
# overwrites it — otherwise clients could forge the addresses in the security log).
TRUST_PROXY_HEADERS = env.bool("TRUST_PROXY_HEADERS", default=False)

# Path the Django admin site is mounted on. Override in production to something non-obvious.
DJANGO_ADMIN_URL = env("DJANGO_ADMIN_URL", default="django-admin/")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Cache (Redis when REDIS_URL is set, in-process memory otherwise)
# ---------------------------------------------------------------------------
REDIS_URL = env("REDIS_URL", default="")

if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
            "KEY_PREFIX": "yathra",
            "TIMEOUT": 300,
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "yathra-default",
        }
    }

# ---------------------------------------------------------------------------
# Authentication & passwords
# ---------------------------------------------------------------------------
AUTH_USER_MODEL = "accounts.User"

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---------------------------------------------------------------------------
# Internationalisation
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Colombo"
USE_I18N = True
USE_TZ = True

DEFAULT_CURRENCY = "LKR"
BOOKING_REFERENCE_PREFIX = env("BOOKING_REFERENCE_PREFIX", default="YT")

# How long a customer keeps the seats they selected while booking (the seat lock), and how
# fast one account may lock seats.
SEAT_LOCK_MINUTES = env.int("SEAT_LOCK_MINUTES", default=5)
SEAT_LOCK_THROTTLE_RATE = env("SEAT_LOCK_THROTTLE_RATE", default="60/min")

# Extras on top of the ticket price (apps/bookings/pricing.py). All zero for now.
BOOKING_PRICING = {
    "SERVICE_FEE_PER_SEAT": env("BOOKING_SERVICE_FEE_PER_SEAT", default="0"),
    "SERVICE_FEE_PERCENT": env("BOOKING_SERVICE_FEE_PERCENT", default="0"),
    "TAX_PERCENT": env("BOOKING_TAX_PERCENT", default="0"),
}

# The cancellation policy (apps/bookings/cancellation.py). Customers are shown these rules and
# the resulting refund by the API — nothing about the policy lives in the browser.
BOOKING_CANCELLATION = {
    # "hours before departure:percent refunded", most generous first.
    "TIERS": env("BOOKING_CANCELLATION_TIERS", default="48:100,24:75,6:50"),
    # Closer than this to departure, only the support team can cancel.
    "CUTOFF_HOURS": env.int("BOOKING_CANCELLATION_CUTOFF_HOURS", default=6),
    # Kept back from every refund.
    "FEE_PER_BOOKING": env("BOOKING_CANCELLATION_FEE_PER_BOOKING", default="0"),
    "FEE_PERCENT": env("BOOKING_CANCELLATION_FEE_PERCENT", default="0"),
}

# ---------------------------------------------------------------------------
# Payments (apps/payments). Gateway credentials only ever come from the environment.
# ---------------------------------------------------------------------------
# Gateways customers can pay with, in display order: "payhere" and/or "mock" (the built-in
# test gateway — never enable it in production).
PAYMENT_PROVIDERS = env.list("PAYMENT_PROVIDERS", default=["mock"] if DEBUG else [])
PAYMENT_DEFAULT_PROVIDER = env("PAYMENT_DEFAULT_PROVIDER", default="")
# Starting a payment keeps the seats for this long (never beyond MAX_HOLD after booking).
PAYMENT_WINDOW_MINUTES = env.int("PAYMENT_WINDOW_MINUTES", default=10)
PAYMENT_MAX_HOLD_MINUTES = env.int("PAYMENT_MAX_HOLD_MINUTES", default=20)
# An attempt the gateway never reported on is given up (cancelled) this long after its hold.
PAYMENT_TIMEOUT_MINUTES = env.int("PAYMENT_TIMEOUT_MINUTES", default=30)
# Where gateways send customers back to, and where they post their notifications.
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000").rstrip("/")
PUBLIC_API_URL = env("PUBLIC_API_URL", default="http://localhost:8000").rstrip("/")
# Signs the built-in test gateway's notifications (derived from SECRET_KEY when empty).
MOCK_PAYMENT_SECRET = env("MOCK_PAYMENT_SECRET", default="")
PAYHERE = {
    "MERCHANT_ID": env("PAYHERE_MERCHANT_ID", default=""),
    "MERCHANT_SECRET": env("PAYHERE_MERCHANT_SECRET", default=""),
    # Optional Business App credentials: enable status look-ups and refunds through the API.
    "APP_ID": env("PAYHERE_APP_ID", default=""),
    "APP_SECRET": env("PAYHERE_APP_SECRET", default=""),
    "SANDBOX": env.bool("PAYHERE_SANDBOX", default=True),
}
PAYMENT_VERIFY_THROTTLE_RATE = env("PAYMENT_VERIFY_THROTTLE_RATE", default="20/min")

# ---------------------------------------------------------------------------
# Static files
# ---------------------------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

# ---------------------------------------------------------------------------
# Django REST Framework
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "DEFAULT_PARSER_CLASSES": ("rest_framework.parsers.JSONParser",),
    "DEFAULT_VERSIONING_CLASS": "rest_framework.versioning.URLPathVersioning",
    "DEFAULT_VERSION": "v1",
    "ALLOWED_VERSIONS": ("v1",),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("THROTTLE_RATE_ANON", default="120/min"),
        "user": env("THROTTLE_RATE_USER", default="600/min"),
        "auth": env("THROTTLE_RATE_AUTH", default="10/min"),
    },
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

# ---------------------------------------------------------------------------
# JWT (djangorestframework-simplejwt)
# ---------------------------------------------------------------------------
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=env.int("JWT_ACCESS_TOKEN_LIFETIME_MINUTES", default=15)
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_REFRESH_TOKEN_LIFETIME_DAYS", default=7)),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": env("JWT_SIGNING_KEY", default=SECRET_KEY),
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    # Embed a hash of the password so every token dies when the password changes.
    "CHECK_REVOKE_TOKEN": True,
    "REVOKE_TOKEN_CLAIM": "hash_password",
}

# The refresh token never touches JavaScript: it lives in an HttpOnly cookie scoped to the
# auth endpoints. The short-lived access token is returned in the response body and kept in memory.
JWT_REFRESH_COOKIE = {
    "NAME": env("JWT_REFRESH_COOKIE_NAME", default="yathra_refresh"),
    "PATH": "/api/v1/auth/",
    "DOMAIN": env("JWT_REFRESH_COOKIE_DOMAIN", default=None),
    "SECURE": env.bool("JWT_REFRESH_COOKIE_SECURE", default=True),
    "SAMESITE": env("JWT_REFRESH_COOKIE_SAMESITE", default="Lax"),
}

# ---------------------------------------------------------------------------
# CORS / CSRF
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True
CORS_URLS_REGEX = r"^/api/.*$"
CORS_ALLOW_HEADERS = (*default_headers, "x-request-id")
CORS_EXPOSE_HEADERS = ["X-Request-ID"]
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# ---------------------------------------------------------------------------
# OpenAPI schema
# ---------------------------------------------------------------------------
API_DOCS_ENABLED = env.bool("API_DOCS_ENABLED", default=False)

SPECTACULAR_SETTINGS = {
    "TITLE": f"{APP_NAME} API",
    "DESCRIPTION": "REST API for the bus booking platform.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": r"/api/v[0-9]+",
    # Several models have a "status" field; give each enum a stable, readable schema name.
    "ENUM_NAME_OVERRIDES": {
        "BookingStatusEnum": "apps.bookings.models.BookingStatus",
        "OperatorStatusEnum": "apps.operators.models.OperatorStatus",
        "PaymentStatusEnum": "apps.payments.models.PaymentStatus",
        "RefundStatusEnum": "apps.payments.models.RefundStatus",
        "TicketStatusEnum": "apps.tickets.models.TicketStatus",
        "TripStatusEnum": "apps.trips.models.TripStatus",
        "SeatLayoutTypeEnum": "apps.fleet.models.SeatLayoutType",
    },
}

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL = env("DJANGO_LOG_LEVEL", default="INFO")
LOG_FORMAT = env("DJANGO_LOG_FORMAT", default="console")  # "console" or "json"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_context": {"()": "apps.core.logging.RequestContextFilter"},
    },
    "formatters": {
        "console": {
            "format": "%(asctime)s %(levelname)-8s [%(request_id)s] %(name)s: %(message)s",
        },
        "json": {"()": "apps.core.logging.JSONFormatter"},
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": LOG_FORMAT,
            "filters": ["request_context"],
        },
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {
        "django": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
        # Request lines are emitted by RequestContextMiddleware (with request id + duration).
        "django.server": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "django.db.backends": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "apps": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
    },
}
