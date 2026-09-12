"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Building2Icon, EyeIcon, PencilIcon, PlusIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";

import { SearchInput, ListToolbar } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { RowActions, useRecordControls } from "@/components/admin/shared/record-controls";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { adminApi } from "@/lib/api/admin";
import type { AdminOperator } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatDate } from "@/lib/format";
import { OPERATOR_STATUSES } from "@/lib/validations/admin";

export function OperatorsList() {
  const list = useListState({ status: "all" });
  const query = useQuery({
    queryKey: queryKeys.admin.list("operators", list.params),
    queryFn: ({ signal }) => adminApi.operators.list(list.params, signal),
    placeholderData: keepPreviousData,
  });
  const controls = useRecordControls("operators", adminApi.operators, "operator");

  const columns: DataTableColumn<AdminOperator>[] = [
    {
      id: "company",
      header: "Company",
      cell: (operator) => (
        <div className="min-w-48">
          <Link href={`/admin/operators/${operator.id}`} className="font-medium hover:underline">
            {operator.company_name}
          </Link>
          <p className="font-mono text-xs text-muted-foreground">{operator.registration_number}</p>
        </div>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      cell: (operator) => (
        <div>
          <p>{operator.contact_email}</p>
          <p className="text-xs text-muted-foreground">{operator.contact_phone}</p>
        </div>
      ),
    },
    {
      id: "buses",
      header: "Buses",
      className: "text-right",
      cell: (operator) => (
        <span className="tabular-nums">
          {operator.active_bus_count}
          <span className="text-muted-foreground"> / {operator.bus_count}</span>
        </span>
      ),
    },
    { id: "status", header: "Status", cell: (operator) => <StatusBadge status={operator.status} /> },
    { id: "joined", header: "Added", cell: (operator) => formatDate(operator.created_at) },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (operator) => {
        const record = { id: operator.id, label: operator.company_name };
        return (
          <RowActions
            label={operator.company_name}
            actions={[
              { label: "View", icon: <EyeIcon />, href: `/admin/operators/${operator.id}` },
              { label: "Edit", icon: <PencilIcon />, href: `/admin/operators/${operator.id}/edit` },
              operator.status === "active"
                ? {
                    label: "Deactivate",
                    icon: <PowerOffIcon />,
                    onSelect: () =>
                      controls.requestDeactivate(
                        record,
                        "Suspended operators can’t be assigned new buses. Existing data is kept.",
                      ),
                  }
                : { label: "Activate", icon: <PowerIcon />, onSelect: () => controls.activate(record) },
              {
                label: "Delete",
                icon: <Trash2Icon />,
                destructive: true,
                separatorBefore: true,
                onSelect: () => controls.requestDelete(record),
              },
            ]}
          />
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operators"
        description="Bus companies that run services on the platform."
        actions={
          <Button asChild size="lg">
            <Link href="/admin/operators/new">
              <PlusIcon data-icon="inline-start" />
              Add operator
            </Link>
          </Button>
        }
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search name, registration, email…"
          label="Search operators"
        />
        <FilterSelect
          label="Status"
          value={list.filters.status}
          onChange={(value) => list.setFilter("status", value)}
          options={OPERATOR_STATUSES}
        />
      </ListToolbar>
      <DataTable
        caption="Operators"
        columns={columns}
        data={query.data?.results}
        getRowId={(operator) => operator.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={Building2Icon}
            title={list.isFiltered ? "No operators match your search" : "No operators yet"}
            description={
              list.isFiltered
                ? "Try a different search term or clear the filters."
                : "Add the first bus company to start building the fleet."
            }
            action={
              list.isFiltered ? (
                <Button variant="outline" onClick={list.reset}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/admin/operators/new">Add operator</Link>
                </Button>
              )
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
          noun="operator"
        />
      )}
      {controls.dialog}
    </div>
  );
}
