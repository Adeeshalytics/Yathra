"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BusFrontIcon, EyeIcon, PencilIcon, PlusIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
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
import type { AdminBus } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { BUS_FACILITIES, BUS_TYPES } from "@/lib/validations/admin";

import { OPERATOR_OPTION_PARAMS } from "./bus-form";
import { FacilityList } from "./facilities";

export const BUS_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  BUS_TYPES.map((type) => [type.value, type.label]),
);

const STATUS_OPTIONS = [
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

export function BusesList() {
  const list = useListState({ operator: "all", bus_type: "all", active: "all", facility: "all" });
  const query = useQuery({
    queryKey: queryKeys.admin.list("buses", list.params),
    queryFn: ({ signal }) => adminApi.buses.list(list.params, signal),
    placeholderData: keepPreviousData,
  });
  const operators = useQuery({
    queryKey: queryKeys.admin.list("operators", OPERATOR_OPTION_PARAMS),
    queryFn: ({ signal }) => adminApi.operators.list(OPERATOR_OPTION_PARAMS, signal),
  });
  const controls = useRecordControls("buses", adminApi.buses, "bus");

  const columns: DataTableColumn<AdminBus>[] = [
    {
      id: "bus",
      header: "Bus",
      cell: (bus) => (
        <div className="min-w-40">
          <Link href={`/admin/buses/${bus.id}`} className="font-medium hover:underline">
            {bus.name}
          </Link>
          <p className="font-mono text-xs text-muted-foreground">{bus.registration_number}</p>
        </div>
      ),
    },
    {
      id: "operator",
      header: "Operator",
      cell: (bus) => (
        <Link href={`/admin/operators/${bus.operator}`} className="hover:underline">
          {bus.operator_name}
        </Link>
      ),
    },
    { id: "type", header: "Type", cell: (bus) => BUS_TYPE_LABEL[bus.bus_type] },
    {
      id: "seats",
      header: "Seats",
      cell: (bus) => (
        <div>
          <p className="tabular-nums">{bus.seat_capacity}</p>
          <p className="max-w-40 truncate text-xs text-muted-foreground">
            {bus.seat_layout_name ?? "No layout"}
          </p>
        </div>
      ),
    },
    { id: "facilities", header: "Facilities", cell: (bus) => <FacilityList facilities={bus.facilities} compact /> },
    { id: "status", header: "Status", cell: (bus) => <ActiveBadge active={bus.active} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (bus) => {
        const record = { id: bus.id, label: bus.registration_number };
        return (
          <RowActions
            label={bus.registration_number}
            actions={[
              { label: "View", icon: <EyeIcon />, href: `/admin/buses/${bus.id}` },
              { label: "Edit", icon: <PencilIcon />, href: `/admin/buses/${bus.id}/edit` },
              bus.active
                ? { label: "Deactivate", icon: <PowerOffIcon />, onSelect: () => controls.requestDeactivate(record) }
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
        title="Buses"
        description="Every vehicle on the platform, its operator, seating and facilities."
        actions={
          <Button asChild size="lg">
            <Link href="/admin/buses/new">
              <PlusIcon data-icon="inline-start" />
              Add bus
            </Link>
          </Button>
        }
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search name, plate, operator…"
          label="Search buses"
        />
        <FilterSelect
          label="Operator"
          value={list.filters.operator}
          onChange={(value) => list.setFilter("operator", value)}
          options={(operators.data?.results ?? []).map((operator) => ({
            value: operator.id,
            label: operator.company_name,
          }))}
        />
        <FilterSelect
          label="Type"
          value={list.filters.bus_type}
          onChange={(value) => list.setFilter("bus_type", value)}
          options={BUS_TYPES}
        />
        <FilterSelect
          label="Facility"
          value={list.filters.facility}
          onChange={(value) => list.setFilter("facility", value)}
          options={BUS_FACILITIES}
          allLabel="Any"
        />
        <FilterSelect
          label="Status"
          value={list.filters.active}
          onChange={(value) => list.setFilter("active", value)}
          options={STATUS_OPTIONS}
        />
      </ListToolbar>
      <DataTable
        caption="Buses"
        columns={columns}
        data={query.data?.results}
        getRowId={(bus) => bus.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={BusFrontIcon}
            title={list.isFiltered ? "No buses match your filters" : "No buses yet"}
            description={
              list.isFiltered
                ? "Try a different search or clear the filters."
                : "Add a bus and assign it to an operator."
            }
            action={
              list.isFiltered ? (
                <Button variant="outline" onClick={list.reset}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/admin/buses/new">Add bus</Link>
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
          noun="bus"
        />
      )}
      {controls.dialog}
    </div>
  );
}
