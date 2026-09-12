"""
Fixtures for the cross-cutting tests: the whole MVP flow, the query budgets and the
security audit.
"""

from apps.bookings.tests.conftest import (  # noqa: F401 — shared fixtures
    alice,
    bob,
    bus,
    client_for,
    hold_and_book,
    lock,
    make_trip,
    route,
    staff,
    trip,
)
