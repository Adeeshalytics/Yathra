from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, DecimalField, Q, Sum, Value
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdmin
from apps.audit.models import ActivityLog
from apps.audit.serializers import ActivityLogSerializer
from apps.bookings.models import Booking, BookingStatus, Passenger
from apps.core.reporting import parse_date_range
from apps.fleet.models import Bus, SeatLayout
from apps.operators.models import Operator, OperatorStatus
from apps.payments.models import CAPTURED_PAYMENT_STATUSES, Payment
from apps.reports.services import occupancy_report, route_report
from apps.routes.models import Route, Stop
from apps.trips.models import Trip, TripStatus

MONEY = DecimalField(max_digits=14, decimal_places=2)

RECENT_ACTIVITY_LIMIT = 10
NEXT_TRIPS_LIMIT = 5


def _active_totals(model) -> dict[str, int]:
    return model.objects.aggregate(total=Count("id"), active=Count("id", filter=Q(active=True)))


class AdminDashboardView(APIView):
    """Headline numbers for the admin dashboard, in a single request."""

    permission_classes = [IsAdmin]

    @extend_schema(responses=OpenApiTypes.OBJECT, summary="Admin dashboard summary")
    def get(self, request, *args, **kwargs):
        now = timezone.now()
        upcoming = Trip.objects.filter(status=TripStatus.SCHEDULED, departure_datetime__gt=now)
        next_trips = upcoming.select_related("route", "bus", "operator").order_by(
            "departure_datetime"
        )[:NEXT_TRIPS_LIMIT]

        return Response(
            {
                "buses": _active_totals(Bus),
                "routes": _active_totals(Route),
                "stops": _active_totals(Stop),
                "seat_layouts": _active_totals(SeatLayout),
                "operators": Operator.objects.aggregate(
                    total=Count("id"),
                    active=Count("id", filter=Q(status=OperatorStatus.ACTIVE)),
                    pending=Count("id", filter=Q(status=OperatorStatus.PENDING)),
                    suspended=Count("id", filter=Q(status=OperatorStatus.SUSPENDED)),
                ),
                "upcoming_trips": {
                    "total": upcoming.count(),
                    "next_7_days": upcoming.filter(
                        departure_datetime__lte=now + timedelta(days=7)
                    ).count(),
                    "next": [
                        {
                            "id": str(trip.id),
                            "code": trip.code,
                            "route_name": trip.route.name,
                            "bus_registration": trip.bus.registration_number,
                            "operator_name": trip.operator.company_name,
                            "departure_datetime": trip.departure_datetime,
                            "active": trip.active,
                        }
                        for trip in next_trips
                    ],
                },
                "recent_activity": ActivityLogSerializer(
                    ActivityLog.objects.all()[:RECENT_ACTIVITY_LIMIT], many=True
                ).data,
            }
        )


TOP_ROUTES_LIMIT = 5


def _by_day(rows, key: str = "day") -> dict:
    return {row[key]: row for row in rows}


def _money(value) -> str:
    return f"{Decimal(value or 0):.2f}"


class AdminDashboardChartsView(APIView):
    """
    The dashboard's charts, aggregated by the database: bookings and revenue per day, the best
    routes, occupancy and cancellations. One request, one row per day — never raw records.
    """

    permission_classes = [IsAdmin]

    @extend_schema(
        parameters=[
            OpenApiParameter("range", OpenApiTypes.STR),
            OpenApiParameter("date_from", OpenApiTypes.DATE),
            OpenApiParameter("date_to", OpenApiTypes.DATE),
        ],
        responses=OpenApiTypes.OBJECT,
        summary="Dashboard charts: bookings, revenue, routes, occupancy, cancellations",
    )
    def get(self, request, *args, **kwargs):
        span = parse_date_range(request.query_params)
        days = span.days()

        bookings = span.filter(Booking.objects.all(), "created_at")
        per_day = _by_day(
            bookings.annotate(day=TruncDate("created_at"))
            .order_by()
            .values("day")
            .annotate(bookings=Count("id"))
        )
        seats_per_day = _by_day(
            Passenger.objects.filter(booking__in=bookings.values("pk"))
            .annotate(day=TruncDate("booking__created_at"))
            .order_by()
            .values("day")
            .annotate(seats=Count("id"))
        )
        revenue_per_day = _by_day(
            span.filter(Payment.objects.filter(status__in=CAPTURED_PAYMENT_STATUSES), "paid_at")
            .annotate(day=TruncDate("paid_at"))
            .order_by()
            .values("day")
            .annotate(
                gross=Coalesce(Sum("amount"), Value(Decimal("0"), output_field=MONEY)),
                refunds=Coalesce(Sum("refunded_amount"), Value(Decimal("0"), output_field=MONEY)),
            )
        )
        cancelled_per_day = _by_day(
            span.filter(Booking.objects.filter(status=BookingStatus.CANCELLED), "cancelled_at")
            .annotate(day=TruncDate("cancelled_at"))
            .order_by()
            .values("day")
            .annotate(cancellations=Count("id"))
        )

        occupancy = occupancy_report(span, {"group_by": "date"})
        occupancy_by_day = {row["group"]: row for row in occupancy.rows}
        routes = route_report(span, request.query_params)

        booking_series, revenue_series, cancellation_series, occupancy_series = [], [], [], []
        for day in days:
            iso = day.isoformat()
            gross = Decimal(revenue_per_day.get(day, {}).get("gross") or 0)
            refunds = Decimal(revenue_per_day.get(day, {}).get("refunds") or 0)
            filled = occupancy_by_day.get(day, {})
            booking_series.append(
                {
                    "date": iso,
                    "bookings": per_day.get(day, {}).get("bookings", 0),
                    "seats": seats_per_day.get(day, {}).get("seats", 0),
                }
            )
            revenue_series.append(
                {
                    "date": iso,
                    "gross": _money(gross),
                    "refunds": _money(refunds),
                    "net": _money(gross - refunds),
                }
            )
            cancellation_series.append(
                {
                    "date": iso,
                    "cancellations": cancelled_per_day.get(day, {}).get("cancellations", 0),
                }
            )
            occupancy_series.append(
                {
                    "date": iso,
                    "occupancy": filled.get("occupancy", 0.0),
                    "seats_sold": filled.get("seats_sold", 0),
                    "capacity": filled.get("capacity", 0),
                }
            )

        totals = bookings.aggregate(
            bookings=Count("id"),
            value=Coalesce(Sum("total_amount"), Value(Decimal("0"), output_field=MONEY)),
        )
        gross_total = sum((Decimal(row["gross"]) for row in revenue_series), Decimal("0"))
        net_total = sum((Decimal(row["net"]) for row in revenue_series), Decimal("0"))
        return Response(
            {
                "range": span.as_dict(),
                "bookings": booking_series,
                "revenue": revenue_series,
                "cancellations": cancellation_series,
                "occupancy": {"summary": occupancy.summary, "by_date": occupancy_series},
                "top_routes": [
                    {
                        "route_id": row["route_id"],
                        "route_name": row["route_name"],
                        "bookings": row["bookings"],
                        "seats_sold": row["seats_sold"],
                        "occupancy": row["occupancy"],
                        "net": _money(row["net"]),
                    }
                    for row in routes.rows[:TOP_ROUTES_LIMIT]
                ],
                "totals": {
                    "bookings": totals["bookings"],
                    "booking_value": _money(totals["value"]),
                    "gross_revenue": _money(gross_total),
                    "net_revenue": _money(net_total),
                    "cancellations": sum(row["cancellations"] for row in cancellation_series),
                    "occupancy": occupancy.summary["occupancy"],
                    "seats_sold": occupancy.summary["seats_sold"],
                    "capacity": occupancy.summary["capacity"],
                },
            }
        )
