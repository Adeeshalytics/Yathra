"""
The admin reporting API.

    GET /api/v1/admin/reports/                  what reports exist, and the date filter
    GET /api/v1/admin/reports/{key}/            totals + one page of rows
    GET /api/v1/admin/reports/{key}/export/     the whole report as CSV, Excel or PDF

Rows are never materialised in full for the JSON response: the page is sliced by the database,
and exports stream from a queryset iterator.
"""

from datetime import date, datetime
from decimal import Decimal

from django.http import Http404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdmin
from apps.core.pagination import StandardPagination
from apps.core.renderers import DownloadNegotiation, FileRenderer
from apps.core.reporting import (
    EXPORT_FORMATS,
    RANGE_KEYS,
    DateRange,
    export_response,
    parse_date_range,
)

from . import services

RANGE_PARAMS = [
    OpenApiParameter("range", OpenApiTypes.STR, enum=list(RANGE_KEYS)),
    OpenApiParameter("date_from", OpenApiTypes.DATE),
    OpenApiParameter("date_to", OpenApiTypes.DATE),
    OpenApiParameter("route", OpenApiTypes.UUID),
    OpenApiParameter("operator", OpenApiTypes.UUID),
    OpenApiParameter("bus", OpenApiTypes.UUID),
    OpenApiParameter("trip", OpenApiTypes.UUID),
]


def jsonify(value):
    """Money as fixed strings and times as ISO, so JSON rows read like the rest of the API."""
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def as_json_row(row: dict) -> dict:
    return {key: jsonify(value) for key, value in row.items()}


def report_or_404(key: str, allowed=None):
    if key not in (services.REPORTS if allowed is None else allowed):
        raise Http404("No such report.")
    return key


class ScopedReportMixin:
    """
    Which reports a view may run, and the filters it runs them with. The admin views use every
    report and the request's own filters; the operator portal narrows both (apps.portal).
    """

    allowed_reports = None  # None: every report

    def report_params(self, request):
        return request.query_params


def describe(key: str, span: DateRange, report: services.Report) -> dict:
    return {
        "key": key,
        "title": report.title,
        "range": span.as_dict(),
        "columns": [{"key": column, "header": header} for column, header in report.columns],
        "summary": report.summary,
    }


TITLES = {
    "bookings": "Booking report",
    "passengers": "Passenger report",
    "revenue": "Revenue report",
    "routes": "Route performance report",
    "occupancy": "Bus occupancy report",
    "cancellations": "Cancellation report",
    "payments": "Payment report",
}


class ReportCatalogueView(APIView):
    """What the reports screen can show, so the UI doesn't hard-code the list."""

    permission_classes = [IsAdmin]

    @extend_schema(
        operation_id="admin_reports_catalogue",
        responses=OpenApiTypes.OBJECT,
        summary="Available reports and filters",
    )
    def get(self, request, *args, **kwargs):
        return Response(
            {
                "reports": [
                    {"key": key, "title": TITLES[key], "description": description}
                    for key, (_, description) in services.REPORTS.items()
                ],
                "ranges": [
                    {"key": "today", "label": "Today"},
                    {"key": "yesterday", "label": "Yesterday"},
                    {"key": "week", "label": "This week"},
                    {"key": "month", "label": "This month"},
                    {"key": "custom", "label": "Custom range"},
                    {"key": "all", "label": "All time"},
                ],
                "formats": list(EXPORT_FORMATS),
                "occupancy_groups": list(services.OCCUPANCY_GROUPS),
            }
        )


class ReportDetailView(ScopedReportMixin, APIView):
    """One report: the totals the database calculated, plus a page of rows."""

    permission_classes = [IsAdmin]

    @extend_schema(
        operation_id="admin_reports_run",
        parameters=RANGE_PARAMS,
        responses=OpenApiTypes.OBJECT,
        summary="Run one report",
    )
    def get(self, request, key: str, *args, **kwargs):
        report_or_404(key, self.allowed_reports)
        span = parse_date_range(request.query_params)
        report = services.build(key, span, self.report_params(request))

        paginator = StandardPagination()
        page = paginator.paginate_queryset(report.rows, request, view=self)
        body = describe(key, span, report)
        body["results"] = [as_json_row(dict(row)) for row in page]
        response = paginator.get_paginated_response(body["results"])
        response.data = {**body, **response.data}
        return response


class ReportExportView(ScopedReportMixin, APIView):
    """The same report as a file. CSV and Excel carry every row; a PDF is capped for reading."""

    permission_classes = [IsAdmin]
    # A download link opened straight from the browser sends Accept: text/html, and
    # `format` here means the file type, not DRF's renderer override.
    renderer_classes = [FileRenderer, JSONRenderer]
    content_negotiation_class = DownloadNegotiation

    def handle_exception(self, exc):
        """Errors are read, not downloaded, so answer them as ordinary JSON."""
        response = super().handle_exception(exc)
        self.request.accepted_renderer = JSONRenderer()
        self.request.accepted_media_type = JSONRenderer.media_type
        response.accepted_renderer = self.request.accepted_renderer
        response.accepted_media_type = self.request.accepted_media_type
        return response

    @extend_schema(
        operation_id="admin_reports_export",
        parameters=[
            *RANGE_PARAMS,
            OpenApiParameter("format", OpenApiTypes.STR, enum=list(EXPORT_FORMATS)),
        ],
        responses={(200, "text/csv"): OpenApiTypes.BINARY},
        summary="Download a report",
    )
    def get(self, request, key: str, *args, **kwargs):
        report_or_404(key, self.allowed_reports)
        span = parse_date_range(request.query_params)
        report = services.build(key, span, self.report_params(request))
        export_format = (request.query_params.get("format") or "csv").lower()

        rows = report.rows
        # Querysets stream straight from the database cursor; grouped reports are small lists.
        if hasattr(rows, "iterator"):
            rows = rows.iterator(chunk_size=500)
        return export_response(
            export_format,
            filename=f"yathra-{key}-{span.from_date or 'all'}",
            title=report.title,
            subtitle=f"{span.label} · generated {date.today():%d %b %Y}",
            columns=report.columns,
            rows=rows,
            summary=report.summary_labels,
        )
