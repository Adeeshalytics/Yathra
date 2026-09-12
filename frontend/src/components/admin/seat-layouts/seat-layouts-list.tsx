"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { EyeIcon, Grid3x3Icon, PencilIcon, PlusIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";

import { ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { RowActions, useRecordControls } from "@/components/admin/shared/record-controls";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { adminApi } from "@/lib/api/admin";
import type { SeatLayoutSummary } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { SEAT_LAYOUT_TYPES } from "@/lib/validations/admin";

export const LAYOUT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  SEAT_LAYOUT_TYPES.map((type) => [type.value, type.label]),
);

export function SeatLayoutsList() {
  const list = useListState({ layout_type: "all", active: "all" });
  const query = useQuery({
    queryKey: queryKeys.admin.list("seat-layouts", list.params),
    queryFn: ({ signal }) => adminApi.seatLayouts.list(list.params, signal),
    placeholderData: keepPreviousData,
  });
  const controls = useRecordControls("seat-layouts", adminApi.seatLayouts, "seat layout");

  const columns: DataTableColumn<SeatLayoutSummary>[] = [
    {
      id: "name",
      header: "Layout",
      cell: (layout) => (
        <div className="max-w-72 min-w-44">
          <Link href={`/admin/seat-layouts/${layout.id}`} className="font-medium hover:underline">
            {layout.name}
          </Link>
          {layout.description && (
            <p className="truncate text-xs text-muted-foreground">{layout.description}</p>
          )}
        </div>
      ),
    },
    { id: "type", header: "Pattern", cell: (layout) => LAYOUT_TYPE_LABEL[layout.layout_type] },
    { id: "grid", header: "Grid", cell: (layout) => `${layout.rows} × ${layout.columns}` },
    {
      id: "seats",
      header: "Bookable / seats",
      className: "text-right",
      cell: (layout) => (
        <span className="tabular-nums">
          {layout.bookable_seat_count}
          <span className="text-muted-foreground"> / {layout.seat_count}</span>
        </span>
      ),
    },
    { id: "buses", header: "Buses", className: "text-right", cell: (layout) => layout.bus_count },
    { id: "status", header: "Status", cell: (layout) => <ActiveBadge active={layout.active} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (layout) => {
        const record = { id: layout.id, label: layout.name };
        return (
          <RowActions
            label={layout.name}
            actions={[
              { label: "View", icon: <EyeIcon />, href: `/admin/seat-layouts/${layout.id}` },
              { label: "Edit", icon: <PencilIcon />, href: `/admin/seat-layouts/${layout.id}/edit` },
              layout.active
                ? {
                    label: "Deactivate",
                    icon: <PowerOffIcon />,
                    onSelect: () =>
                      controls.requestDeactivate(
                        record,
                        "Buses already using it keep it; it just can’t be assigned to more buses.",
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
        title="Seat layouts"
        description="Reusable seat maps. Buses reference a layout and passengers pick seats from it."
        actions={
          <Button asChild size="lg">
            <Link href="/admin/seat-layouts/new">
              <PlusIcon data-icon="inline-start" />
              New layout
            </Link>
          </Button>
        }
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search layouts…" label="Search seat layouts" />
        <FilterSelect
          label="Pattern"
          value={list.filters.layout_type}
          onChange={(value) => list.setFilter("layout_type", value)}
          options={SEAT_LAYOUT_TYPES}
        />
        <FilterSelect
          label="Status"
          value={list.filters.active}
          onChange={(value) => list.setFilter("active", value)}
          options={[
            { value: "true", label: "Active" },
            { value: "false", label: "Inactive" },
          ]}
        />
      </ListToolbar>
      <DataTable
        caption="Seat layouts"
        columns={columns}
        data={query.data?.results}
        getRowId={(layout) => layout.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={Grid3x3Icon}
            title={list.isFiltered ? "No layouts match" : "No seat layouts yet"}
            description={
              list.isFiltered ? "Try a different search or clear the filters." : "Create a 2 + 2 or 2 + 1 layout to get started."
            }
            action={
              list.isFiltered ? (
                <Button variant="outline" onClick={list.reset}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/admin/seat-layouts/new">New layout</Link>
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
          noun="layout"
        />
      )}
      {controls.dialog}
    </div>
  );
}
