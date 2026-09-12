"""
Shared plumbing for the admin reports: the date filter every report accepts, and exports.

Reports are aggregated by the database and streamed out row by row — nothing here ever loads a
whole result set into memory, and the browser is only ever sent one page of rows plus the
totals the database calculated.
"""

import csv
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db.models import QuerySet
from django.http import HttpResponse, StreamingHttpResponse
from django.utils import timezone
from rest_framework.exceptions import ValidationError

# What the date filter offers. "all" is used by screens that shouldn't default to a window.
RANGE_KEYS = ("today", "yesterday", "week", "month", "custom", "all")
DEFAULT_RANGE = "month"
EXPORT_FORMATS = ("csv", "xlsx", "pdf")
# A PDF is for reading, not for archiving a million rows; CSV and Excel carry the whole set.
PDF_ROW_LIMIT = 1000
XLSX_ROW_LIMIT = 100_000


@dataclass(frozen=True)
class DateRange:
    """An inclusive span of local (Asia/Colombo) days, as the instants that bound it."""

    key: str
    label: str
    from_date: date | None
    to_date: date | None

    @property
    def start(self) -> datetime | None:
        if self.from_date is None:
            return None
        return timezone.make_aware(datetime.combine(self.from_date, time.min))

    @property
    def end(self) -> datetime | None:
        if self.to_date is None:
            return None
        return timezone.make_aware(datetime.combine(self.to_date, time.max))

    def filter(self, queryset: QuerySet, field: str) -> QuerySet:
        """Narrow `queryset` to this span on a datetime field."""
        if self.start is not None:
            queryset = queryset.filter(**{f"{field}__gte": self.start})
        if self.end is not None:
            queryset = queryset.filter(**{f"{field}__lte": self.end})
        return queryset

    def days(self) -> list[date]:
        """Every day in the span, so a chart can show days with no activity as zero."""
        if self.from_date is None or self.to_date is None:
            return []
        span = (self.to_date - self.from_date).days
        return [self.from_date + timedelta(days=offset) for offset in range(span + 1)]

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "from_date": self.from_date.isoformat() if self.from_date else None,
            "to_date": self.to_date.isoformat() if self.to_date else None,
        }


def _parse_day(raw: str | None, field: str) -> date | None:
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({field: ["Use a date like 2026-09-15."]}) from None


def parse_date_range(params) -> DateRange:
    """Read `?range=` (plus `date_from` / `date_to` for a custom span) from a request."""
    key = (params.get("range") or DEFAULT_RANGE).lower()
    if key not in RANGE_KEYS:
        raise ValidationError({"range": [f"Choose one of: {', '.join(RANGE_KEYS)}."]})
    today = timezone.localdate()

    if key == "today":
        return DateRange(key, "Today", today, today)
    if key == "yesterday":
        yesterday = today - timedelta(days=1)
        return DateRange(key, "Yesterday", yesterday, yesterday)
    if key == "week":
        monday = today - timedelta(days=today.weekday())
        return DateRange(key, "This week", monday, today)
    if key == "month":
        return DateRange(key, "This month", today.replace(day=1), today)
    if key == "all":
        return DateRange(key, "All time", None, None)

    from_date = _parse_day(params.get("date_from"), "date_from")
    to_date = _parse_day(params.get("date_to"), "date_to")
    if from_date and to_date and from_date > to_date:
        raise ValidationError({"date_to": ["The end date comes before the start date."]})
    label = (
        f"{from_date:%d %b %Y} – {to_date:%d %b %Y}"
        if from_date and to_date
        else f"From {from_date:%d %b %Y}"
        if from_date
        else f"Until {to_date:%d %b %Y}"
        if to_date
        else "All time"
    )
    return DateRange(key, label, from_date, to_date)


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------
def format_cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return timezone.localtime(value).strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)


class _Echo:
    """A file-like object that returns what it is handed, so csv can stream."""

    def write(self, value):
        return value


def _csv_response(filename: str, columns, rows: Iterable[dict]) -> StreamingHttpResponse:
    writer = csv.writer(_Echo())

    def stream() -> Iterator[str]:
        yield writer.writerow([header for _, header in columns])
        for row in rows:
            yield writer.writerow([format_cell(row.get(key)) for key, _ in columns])

    response = StreamingHttpResponse(stream(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
    return response


def _xlsx_response(filename: str, title: str, columns, rows: Iterable[dict]) -> HttpResponse:
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.cell import WriteOnlyCell
    from openpyxl.styles import Font

    # Write-only mode streams rows to the file instead of building a sheet in memory.
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet(title=(title[:31] or "Report"))
    bold = Font(bold=True)

    def heading(text: str):
        cell = WriteOnlyCell(sheet, value=text)
        cell.font = bold
        return cell

    sheet.append([heading(header) for _, header in columns])
    for index, row in enumerate(rows):
        if index >= XLSX_ROW_LIMIT:
            break
        sheet.append([format_cell(row.get(key)) for key, _ in columns])

    buffer = BytesIO()
    workbook.save(buffer)
    response = HttpResponse(
        buffer.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}.xlsx"'
    return response


def _pdf_response(
    filename: str, title: str, subtitle: str, columns, rows: Iterable[dict], summary: list | None
) -> HttpResponse:
    from io import BytesIO

    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        title=title,
        author="Yathra",
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
    )
    heading = ParagraphStyle("heading", fontName="Helvetica-Bold", fontSize=15, spaceAfter=2)
    sub = ParagraphStyle(
        "sub", fontName="Helvetica", fontSize=9, textColor=colors.HexColor("#64748B")
    )
    cell = ParagraphStyle("cell", fontName="Helvetica", fontSize=7.5, leading=9, alignment=TA_LEFT)

    story = [Paragraph(title, heading), Paragraph(subtitle, sub), Spacer(1, 6 * mm)]
    if summary:
        story.append(
            Table(
                [[f"{label}: {value}" for label, value in summary]],
                style=TableStyle(
                    [
                        ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
                        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F1F5F9")),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                        ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ]
                ),
            )
        )
        story.append(Spacer(1, 5 * mm))

    data = [[Paragraph(f"<b>{header}</b>", cell) for _, header in columns]]
    truncated = False
    for index, row in enumerate(rows):
        if index >= PDF_ROW_LIMIT:
            truncated = True
            break
        data.append([Paragraph(format_cell(row.get(key)), cell) for key, _ in columns])

    table = Table(data, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0B6E69")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E2E8F0")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(table)
    if truncated:
        story.append(Spacer(1, 4 * mm))
        story.append(
            Paragraph(
                f"Only the first {PDF_ROW_LIMIT:,} rows are shown. Export to CSV or Excel for "
                "the complete report.",
                sub,
            )
        )
    document.build(story)

    response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}.pdf"'
    return response


def export_response(
    export_format: str,
    *,
    filename: str,
    title: str,
    subtitle: str = "",
    columns: list[tuple[str, str]],
    rows: Iterable[dict],
    summary: list[tuple[str, str]] | None = None,
) -> HttpResponse:
    """One report, one download. `rows` should be a lazy iterable (a queryset iterator)."""
    if export_format not in EXPORT_FORMATS:
        raise ValidationError({"format": [f"Choose one of: {', '.join(EXPORT_FORMATS)}."]})
    if export_format == "csv":
        return _csv_response(filename, columns, rows)
    if export_format == "xlsx":
        return _xlsx_response(filename, title, columns, rows)
    return _pdf_response(filename, title, subtitle, columns, rows, summary)
