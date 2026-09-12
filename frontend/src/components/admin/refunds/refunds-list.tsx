"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DateFilter, ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { adminApi } from "@/lib/api/admin";
import type { AdminRefund } from "@/lib/api/payment-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatCurrency, formatDateTime } from "@/lib/format";

import { RefundStatusDialog } from "./refund-status-dialog";

const STATUS_OPTIONS = [
  { value: "requested", label: "Requested" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
];

export function RefundsList() {
  const [managing, setManaging] = useState<AdminRefund | null>(null);
  const list = useListState({ status: "all", date_from: "", date_to: "" });
  const query = useQuery({
    queryKey: queryKeys.admin.list("refunds", list.params),
    queryFn: ({ signal }) => adminApi.refunds.list(list.params, signal),
    placeholderData: keepPreviousData,
  });

  const columns: DataTableColumn<AdminRefund>[] = [
    {
      id: "requested",
      header: "Requested on",
      cell: (refund) => (
        <span className="whitespace-nowrap">{formatDateTime(refund.created_at)}</span>
      ),
    },
    {
      id: "reference",
      header: "Refund",
      cell: (refund) => (
        <div className="min-w-32">
          <p className="font-mono text-sm font-medium">{refund.reference}</p>
          <p className="max-w-48 truncate text-xs text-muted-foreground">{refund.reason || "—"}</p>
        </div>
      ),
    },
    {
      id: "booking",
      header: "Booking",
      cell: (refund) => (
        <div className="min-w-36">
          <p className="font-mono text-sm">{refund.booking_reference}</p>
          <p className="max-w-44 truncate text-xs text-muted-foreground">{refund.customer.name}</p>
        </div>
      ),
    },
    {
      id: "trip",
      header: "Trip",
      cell: (refund) => (
        <Link href={`/admin/trips/${refund.trip.id}`} className="hover:underline">
          <span className="font-mono text-sm">{refund.trip.code}</span>
          <span className="block max-w-44 truncate text-xs text-muted-foreground">
            {refund.trip.route}
          </span>
        </Link>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      className: "text-right",
      cell: (refund) => (
        <span className="font-medium tabular-nums">
          {formatCurrency(refund.amount, refund.currency)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (refund) => <StatusBadge status={refund.status} label={refund.status_label} />,
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "text-right",
      cell: (refund) =>
        refund.resolved_at ? (
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {formatDateTime(refund.resolved_at)}
          </span>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setManaging(refund)}>
            Manage
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description="Money owed back to customers: cancellations under the refund policy, and payments that couldn’t be used."
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search refund, booking, customer…"
          label="Search refunds"
        />
        <FilterSelect
          label="Status"
          value={list.filters.status}
          onChange={(value) => list.setFilter("status", value)}
          options={STATUS_OPTIONS}
        />
        <DateFilter
          label="From date"
          value={list.filters.date_from}
          onChange={(value) => list.setFilter("date_from", value)}
        />
        <DateFilter
          label="To date"
          value={list.filters.date_to}
          onChange={(value) => list.setFilter("date_to", value)}
        />
      </ListToolbar>
      <DataTable
        caption="Refunds"
        columns={columns}
        data={query.data?.results}
        getRowId={(refund) => refund.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={Undo2Icon}
            title={list.isFiltered ? "No refunds match your filters" : "No refunds to make"}
            description={
              list.isFiltered
                ? "Try another status or date, or clear the filters."
                : "Cancellations that earn a refund show up here for the team to process."
            }
            action={
              list.isFiltered ? (
                <Button variant="outline" onClick={list.reset}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        }
      />
      {query.data && (
        <PaginationBar
          page={list.page}
          totalPages={query.data.total_pages}
          count={query.data.count}
          onPageChange={list.setPage}
          isFetching={query.isFetching}
          noun="refund"
        />
      )}
      {managing && (
        <RefundStatusDialog refund={managing} onClose={() => setManaging(null)} />
      )}
    </div>
  );
}
