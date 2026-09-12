"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CreditCardIcon } from "lucide-react";
import Link from "next/link";

import { DateFilter, ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useListState } from "@/hooks/use-list-state";
import { adminApi } from "@/lib/api/admin";
import type { AdminPayment } from "@/lib/api/payment-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { PAYMENT_PROVIDER_OPTIONS, PAYMENT_STATUS_OPTIONS, REFUND_FILTER_OPTIONS } from "./payment-options";

export function NeedsRefundBadge() {
  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">
      Needs refund
    </Badge>
  );
}

function PaymentSummaryCards() {
  const query = useQuery({
    queryKey: queryKeys.admin.paymentSummary,
    queryFn: ({ signal }) => adminApi.payments.summary(signal),
  });
  if (query.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (query.isError) return null;
  const summary = query.data;
  const cards = [
    { label: "Collected today", value: formatCurrency(summary.collected_today, summary.currency) },
    { label: "Last 30 days", value: formatCurrency(summary.collected_30_days, summary.currency) },
    { label: "Waiting on the gateway", value: String(summary.open) },
    { label: "Refunds to make", value: String(summary.needs_refund), alert: summary.needs_refund > 0 },
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className={cn(card.alert && "border-amber-300 bg-amber-50")}>
          <CardContent className="space-y-1">
            <dt className="text-sm text-muted-foreground">{card.label}</dt>
            <dd className="font-heading text-2xl font-bold tabular-nums">{card.value}</dd>
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}

const COLUMNS: DataTableColumn<AdminPayment>[] = [
  {
    id: "date",
    header: "Date",
    cell: (payment) => <span className="whitespace-nowrap">{formatDateTime(payment.created_at)}</span>,
  },
  {
    id: "transaction",
    header: "Transaction reference",
    cell: (payment) => (
      <div className="min-w-44">
        <Link href={`/admin/payments/${payment.id}`} className="font-mono text-sm font-medium hover:underline">
          {payment.transaction_reference}
        </Link>
        {payment.provider_reference && (
          <p className="font-mono text-xs text-muted-foreground">{payment.provider_reference}</p>
        )}
      </div>
    ),
  },
  {
    id: "booking",
    header: "Booking reference",
    cell: (payment) => (
      <div className="min-w-36">
        <p className="font-mono text-sm">{payment.booking_reference}</p>
        <p className="max-w-44 truncate text-xs text-muted-foreground">{payment.customer.name}</p>
      </div>
    ),
  },
  {
    id: "provider",
    header: "Paid with",
    cell: (payment) => (
      <div>
        <p>{payment.provider_name}</p>
        <p className="text-xs text-muted-foreground">{payment.payment_method_label || "—"}</p>
      </div>
    ),
  },
  {
    id: "amount",
    header: "Amount",
    className: "text-right",
    cell: (payment) => (
      <div className="tabular-nums">
        <p className="font-medium">{formatCurrency(payment.amount, payment.currency)}</p>
        {Number(payment.refunded_amount) > 0 && (
          <p className="text-xs text-muted-foreground">
            − {formatCurrency(payment.refunded_amount, payment.currency)} refunded
          </p>
        )}
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: (payment) => (
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge status={payment.status} label={payment.status_label} />
        {payment.requires_refund && <NeedsRefundBadge />}
      </div>
    ),
  },
];

export function PaymentsList() {
  const list = useListState({ status: "all", provider: "all", requires_refund: "all", date_from: "", date_to: "" });
  const query = useQuery({
    queryKey: queryKeys.admin.list("payments", list.params),
    queryFn: ({ signal }) => adminApi.payments.list(list.params, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Every payment attempt, verified with its gateway. Refund or re-check a payment from its page."
      />
      <PaymentSummaryCards />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search reference, booking, customer…"
          label="Search payments"
        />
        <FilterSelect
          label="Status"
          value={list.filters.status}
          onChange={(value) => list.setFilter("status", value)}
          options={PAYMENT_STATUS_OPTIONS}
        />
        <FilterSelect
          label="Gateway"
          value={list.filters.provider}
          onChange={(value) => list.setFilter("provider", value)}
          options={PAYMENT_PROVIDER_OPTIONS}
        />
        <FilterSelect
          label="Refunds"
          value={list.filters.requires_refund}
          onChange={(value) => list.setFilter("requires_refund", value)}
          options={REFUND_FILTER_OPTIONS}
        />
        <DateFilter label="From date" value={list.filters.date_from} onChange={(value) => list.setFilter("date_from", value)} />
        <DateFilter label="To date" value={list.filters.date_to} onChange={(value) => list.setFilter("date_to", value)} />
      </ListToolbar>
      <DataTable
        caption="Payments"
        columns={COLUMNS}
        data={query.data?.results}
        getRowId={(payment) => payment.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={CreditCardIcon}
            title={list.isFiltered ? "No payments match your filters" : "No payments yet"}
            description={
              list.isFiltered
                ? "Try another status or date, or clear the filters."
                : "Payments appear here as soon as customers press Pay Now."
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
          noun="payment"
        />
      )}
    </div>
  );
}
