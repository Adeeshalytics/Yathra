from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import (
    OperatorBookingViewSet,
    OperatorDashboardView,
    OperatorReportExportView,
    OperatorReportView,
    OperatorTripViewSet,
)

router = SimpleRouter()
router.register("operator/trips", OperatorTripViewSet, basename="operator-trip")
router.register("operator/bookings", OperatorBookingViewSet, basename="operator-booking")

urlpatterns = [
    path("operator/dashboard/", OperatorDashboardView.as_view(), name="operator-dashboard"),
    path("operator/reports/<slug:key>/", OperatorReportView.as_view(), name="operator-report"),
    path(
        "operator/reports/<slug:key>/export/",
        OperatorReportExportView.as_view(),
        name="operator-report-export",
    ),
    *router.urls,
]
