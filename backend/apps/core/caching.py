"""
HTTP caching for the handful of endpoints where it is safe.

Only public reference data qualifies: the stops and routes that fill the search pickers change
a few times a month, are the same for everyone, and cost a join each time they are asked for.
Everything else — availability, bookings, payments, reports — must never be cached, because a
stale answer there is a wrong answer.
"""

from rest_framework.response import Response


class PublicCacheMixin:
    """
    Let shared caches (a CDN, a reverse proxy) keep GET responses for `cache_seconds`.

    `stale-while-revalidate` lets them serve the old copy for a moment while they fetch a fresh
    one, so a cold cache never makes a customer wait. Anything but a plain GET, and any request
    that carries a session, is left alone.
    """

    cache_seconds = 300

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        cacheable = (
            request.method == "GET"
            and isinstance(response, Response)
            and response.status_code == 200
            and not request.user.is_authenticated
        )
        if cacheable:
            response["Cache-Control"] = (
                f"public, max-age={self.cache_seconds}, stale-while-revalidate={self.cache_seconds}"
            )
        else:
            response.setdefault("Cache-Control", "no-store")
        return response
