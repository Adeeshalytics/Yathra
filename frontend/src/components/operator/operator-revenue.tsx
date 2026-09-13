"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ChartColumnIcon, DownloadIcon, Loader2Icon, LockIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  DateRangeFilter,
  DEFAULT_RANGE,
  rangeParams,
  type DateRangeValue,
} from "@/components/admin/reports/date-range-filter";
import { formatReportValue, summaryEntries } from "@/components/admin/reports/report-format";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { operatorApi } from "@/lib/api/endpoints";
import { getErrorMessage } from "@/lib/api/errors";
import type { OperatorReportKey } from "@/lib/api/portal-types";
import { queryKeys } from "@/lib/api/query-keys";
import type { ExportFormat, ReportRow } from "@/lib/api/report-types";
import { saveBlob } from "@/lib/payment";

import { canSeeRevenue, useOperatorProfile } from "./operator-gate";

const VIEWS: { key: OperatorReportKey; label: string }[] = [
  { key: "revenue", label: "By day" },
  { key: "routes", label: "By route" },
];
const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: "csv", label: "CSV" },
  { format: "xlsx", label: "Excel" },
  { format: "pdf", label: "PDF" },
];

/** The company's takings, day by day or route by route, for any period — and as a file. */
export function OperatorRevenue() {
  const profile = useOperatorProfile();
  const allowed = canSeeRevenue(profile.data);
  const [view, setView] = useState<OperatorReportKey>("revenue");
  const [range, setRange] = useState<DateRangeValue>(DEFAULT_RANGE);
  const [page, setPage] = useState(1);
  const params = { ...rangeParams(range), page };

  const query = useQuery({
    queryKey: queryKeys.operator.report(view, params),
    queryFn: ({ signal }) => operatorApi.reports.run(view, params, signal),
    placeholderData: keepPreviousData,
    enabled: allowed,
  });
  const download = useMutation({
    mutationFn: (format: ExportFormat) =>
      operatorApi.reports.download(view, format, rangeParams(range)),
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename),
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  if (profile.data && !allowed) {
    return (
      <EmptyState
        icon={LockIcon}
        title="Takings are for owners and managers"
        description="Ask your company’s owner if you need to see the revenue."
      />
    );
  }

  const report = query.data;
  const columns: DataTableColumn<ReportRow>[] = (report?.columns ?? []).map((column) => ({
    id: column.key,
    header: column.header,
    cell: (row) => <span className="whitespace-nowrap">{formatReportValue(column.key, row[column.key])}</span>,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revenue"
        description="What your trips took, after refunds. Worked out from confirmed payments."
        actions={
          <div className="flex flex-wrap gap-2">
            {FORMATS.map(({ format, label }) => (
              <Button
                key={format}
                variant="outline"
                onClick={() => download.mutate(format)}
                disabled={download.isPending || !report}
              >
                {download.isPending && download.variables === format ? (
                  <Loader2Icon className="animate-spin" data-icon="inline-start" />
                ) : (
                  <DownloadIcon data-icon="inline-start" />
                )}
                {label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Tabs
          value={view}
          onValueChange={(value) => {
            setView(value as OperatorReportKey);
            setPage(1);
          }}
        >
          <TabsList>
            {VIEWS.map((entry) => (
              <TabsTrigger key={entry.key} value={entry.key}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <DateRangeFilter
          value={range}
          onChange={(value) => {
            setRange(value);
            setPage(1);
          }}
          ranges={[]}
        />
      </div>

      {query.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : report ? (
        <dl role="group" aria-label="Totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryEntries(report.summary)
            .filter((entry) => entry.key !== "best_route" && entry.key !== "routes")
            .map((entry) => (
              <Card key={entry.key}>
                <CardContent className="space-y-1">
                  <dt className="text-sm text-muted-foreground">{entry.label}</dt>
                  <dd className="font-heading text-2xl font-bold tabular-nums">{entry.value}</dd>
                </CardContent>
              </Card>
            ))}
        </dl>
      ) : null}

      <DataTable
        caption={report?.title ?? "Revenue"}
        columns={columns.length > 0 ? columns : [{ id: "loading", header: " ", cell: () => null }]}
        data={report?.results}
        getRowId={(row) => String(row.route_id ?? row.day ?? JSON.stringify(row))}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={ChartColumnIcon}
            title="No takings in this period"
            description="Try a wider date range."
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
