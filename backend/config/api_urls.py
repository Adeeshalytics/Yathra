"""URL map for /api/v1/."""

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from apps.audit.views import ActivityLogViewSet
from apps.bookings.admin_views import AdminBookingViewSet, AdminPassengerViewSet
from apps.core.views import HealthCheckView
from apps.dashboard.views import AdminDashboardChartsView, AdminDashboardView
from apps.fleet.admin_views import AdminBusViewSet, AdminSeatLayoutViewSet
from apps.operators.admin_views import AdminOperatorViewSet
from apps.payments.admin_views import AdminPaymentViewSet, AdminRefundViewSet
from apps.routes.admin_views import AdminRouteViewSet, AdminStopViewSet
from apps.trips.admin_views import AdminTripScheduleViewSet, AdminTripViewSet

# /api/v1/admin/... — platform administration (admin role only).
admin_router = SimpleRouter()
admin_router.register("operators", AdminOperatorViewSet, basename="admin-operator")
admin_router.register("buses", AdminBusViewSet, basename="admin-bus")
admin_router.register("seat-layouts", AdminSeatLayoutViewSet, basename="admin-seat-layout")
admin_router.register("routes", AdminRouteViewSet, basename="admin-route")
admin_router.register("stops", AdminStopViewSet, basename="admin-stop")
admin_router.register("trips", AdminTripViewSet, basename="admin-trip")
admin_router.register("trip-schedules", AdminTripScheduleViewSet, basename="admin-trip-schedule")
admin_router.register("bookings", AdminBookingViewSet, basename="admin-booking")
admin_router.register("passengers", AdminPassengerViewSet, basename="admin-passenger")
admin_router.register("payments", AdminPaymentViewSet, basename="admin-payment")
admin_router.register("refunds", AdminRefundViewSet, basename="admin-refund")
admin_router.register("activity", ActivityLogViewSet, basename="admin-activity")

urlpatterns = [
    path("health/", HealthCheckView.as_view(), name="health"),
    path("auth/", include("apps.accounts.urls")),
    path("admin/dashboard/", AdminDashboardView.as_view(), name="admin-dashboard"),
    path(
        "admin/dashboard/charts/",
        AdminDashboardChartsView.as_view(),
        name="admin-dashboard-charts",
    ),
    path("", include("apps.reports.urls")),
    path("admin/", include(admin_router.urls)),
    path("", include("apps.routes.urls")),
    path("", include("apps.trips.urls")),
    path("", include("apps.bookings.urls")),
    path("", include("apps.payments.urls")),
    path("", include("apps.tickets.urls")),
    path("", include("apps.operators.urls")),
]
