"""
Staging settings: production, with the things a pre-production site needs.

Staging runs the same hardened stack as production — HTTPS, secure cookies, WhiteNoise, real
logging — but it is allowed to take fake money through the built-in test gateway, and it serves
the API documentation so the team can try endpoints out. Nothing here loosens authentication,
authorization or transport security.
"""

import os

# Staging is a production deployment that may use the test gateway.
os.environ.setdefault("ALLOW_MOCK_PAYMENTS", "true")

from .production import *  # noqa: F403
from .production import env

# The interactive schema is useful on staging and off in production.
API_DOCS_ENABLED = env.bool("API_DOCS_ENABLED", default=True)

# A short HSTS window, so a staging domain is never pinned to HTTPS for months by mistake.
SECURE_HSTS_SECONDS = env.int("DJANGO_SECURE_HSTS_SECONDS", default=60)
SECURE_HSTS_PRELOAD = False

# Staging usually carries seeded data worth inspecting, so keep the noisier log level available.
LOG_LEVEL = env("DJANGO_LOG_LEVEL", default="INFO")
