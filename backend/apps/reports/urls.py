from django.urls import path

from .views import ReportCatalogueView, ReportDetailView, ReportExportView

urlpatterns = [
    path("admin/reports/", ReportCatalogueView.as_view(), name="admin-reports"),
    path("admin/reports/<slug:key>/", ReportDetailView.as_view(), name="admin-report"),
    path(
        "admin/reports/<slug:key>/export/",
        ReportExportView.as_view(),
        name="admin-report-export",
    ),
]
