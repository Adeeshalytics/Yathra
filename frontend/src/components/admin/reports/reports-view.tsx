"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ChartColumnIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi, type ListParams } from "@/lib/api/admin";
import { getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  ExportFormat,
  OccupancyGroup,
  ReportKey,
  ReportResponse,
  ReportRow,
} from "@/lib/api/report-types";
import { saveBlob } from "@/lib/payment";

import { DateRangeFilter, DEFAULT_RANGE, rangeParams, type DateRangeValue } from "./date-range-filter";
import { formatReportValue, summaryEntries } from "./report-format";

const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  xlsx: "Excel",
  pdf: "PDF",
};

const GROUP_LABELS: Record<OccupancyGroup, string> = {
  trip: "By trip",
  route: "By route",
  bus: "By bus",
  date: "By date",
};

/** A plain picker (no "All" choice): a report is always one of the seven. */
function PickSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={className ?? "h-10 w-full sm:w-56"}>
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Grouped rows have no id of their own, so the first column identifies the row. */
function rowKey(row: ReportRow, firstColumn: string | undefined): string {
  return String(row.id ?? row.group ?? (firstColumn ? row[firstColumn] : "") ?? "");
}

function SummaryCards({ report }: { report: ReportResponse }) {
  const entries = summaryEntries(report.summary);
  if (entries.length === 0) return null;
  return (
    <dl role="group" aria-label="Report totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {entries.map((entry) => (
        <Card key={entry.key}>
          <CardContent className="space-y-1">
            <dt className="text-sm text-muted-foreground">{entry.label}</dt>
            <dd className="font-heading text-2xl font-bold tabular-nums">{entry.value}</dd>
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}

function ExportButtons({
  reportKey,
  params,
  formats,
}: {
  reportKey: ReportKey;
  params: ListParams;
  formats: ExportFormat[];
}) {
  const download = useMutation({
    mutationFn: (format: ExportFormat) => adminApi.reports.download(reportKey, format, params),
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename),
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  return (
    <div className="flex flex-wrap gap-2">
      {formats.map((format) => (
        <Button
          key={format}
          variant="outline"
          onClick={() => download.mutate(format)}
          disabled={download.isPending}
        >
          {download.isPending && download.variables === format ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <DownloadIcon data-icon="inline-start" />
          )}
          {FORMAT_LABELS[format]}
        </Button>
      ))}
    </div>
  );
}

export function ReportsView() {
  const [reportKey, setReportKey] = useState<ReportKey>("bookings");
  const [range, setRange] = useState<DateRangeValue>(DEFAULT_RANGE);
  const [groupBy, setGroupBy] = useState<OccupancyGroup>("trip");
  const [page, setPage] = useState(1);

  const catalogue = useQuery({
    queryKey: queryKeys.admin.reportCatalogue,
    queryFn: ({ signal }) => adminApi.reports.catalogue(signal),
    staleTime: 5 * 60 * 1000,
  });

  const params: ListParams = {
    ...rangeParams(range),
    page,
    ...(reportKey === "occupancy" && { group_by: groupBy }),
  };
  const query = useQuery({
    queryKey: queryKeys.admin.report(reportKey, params),
    queryFn: ({ signal }) => adminApi.reports.run(reportKey, params, signal),
    placeholderData: keepPreviousData,
  });

  const report = query.data;
  const columns: DataTableColumn<ReportRow>[] = (report?.columns ?? []).map((column) => ({
    id: column.key,
    header: column.header,
    cell: (row) => (
      <span className="whitespace-nowrap">{formatReportValue(column.key, row[column.key])}</span>
    ),
  }));
  const chosen = catalogue.data?.reports.find((entry) => entry.key === reportKey);

  const change = (next: () => void) => {
    next();
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={chosen?.description ?? "Bookings, passengers, takings and occupancy — all worked out by the server."}
        actions={
          report && catalogue.data ? (
            <ExportButtons
              reportKey={reportKey}
              params={{ ...params, page: undefined }}
              formats={catalogue.data.formats}
            />
          ) : undefined
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <PickSelect
          label="Report"
          value={reportKey}
          onChange={(value) => change(() => setReportKey(value as ReportKey))}
          options={(catalogue.data?.reports ?? [{ key: reportKey, title: "Booking report" }]).map(
            (entry) => ({ value: entry.key, label: entry.title }),
          )}
          className="h-10 w-full sm:w-60"
        />
        <DateRangeFilter
          value={range}
          onChange={(value) => change(() => setRange(value))}
          ranges={catalogue.data?.ranges ?? []}
        />
        {reportKey === "occupancy" && (
          <PickSelect
            label="Group"
            value={groupBy}
            onChange={(value) => change(() => setGroupBy(value as OccupancyGroup))}
            options={(catalogue.data?.occupancy_groups ?? ["trip"]).map((group) => ({
              value: group,
              label: GROUP_LABELS[group],
            }))}
            className="h-10 w-full sm:w-44"
          />
        )}
      </div>

      {query.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : report ? (
        <>
          <div className="space-y-1">
            <h2 className="font-heading text-xl font-bold">{report.title}</h2>
            <p className="text-sm text-muted-foreground">
              {report.range.label}
              {report.range.from_date && report.range.to_date
                ? ` · ${report.range.from_date} to ${report.range.to_date}`
                : ""}
            </p>
          </div>
          <SummaryCards report={report} />
        </>
      ) : null}

      <DataTable
        caption={report?.title ?? "Report"}
        columns={columns.length > 0 ? columns : [{ id: "loading", header: " ", cell: () => null }]}
        data={report?.results}
        getRowId={(row) => rowKey(row, report?.columns[0]?.key)}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={ChartColumnIcon}
            title="Nothing in this period"
            description="Try a wider date range — the report is empty for the dates you picked."
          />
        }
      />
      {report && (
        <PaginationBar
          page={report.page}
          totalPages={report.total_pages}
          count={report.count}
          onPageChange={setPage}
          isFetching={query.isFetching}
          noun="row"
        />
      )}
    </div>
  );
}
