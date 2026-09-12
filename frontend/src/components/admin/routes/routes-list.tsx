"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, EyeIcon, PencilIcon, PlusIcon, PowerIcon, PowerOffIcon, RouteIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";

import { ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { RowActions, useRecordControls } from "@/components/admin/shared/record-controls";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { adminApi } from "@/lib/api/admin";
import type { AdminRouteSummary } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { formatCurrency, formatDuration } from "@/lib/format";

export function RoutesList() {
  const list = useListState({ active: "all" });
  const query = useQuery({
    queryKey: queryKeys.admin.list("routes", list.params),
    queryFn: ({ signal }) => adminApi.routes.list(list.params, signal),
    placeholderData: keepPreviousData,
  });
  const controls = useRecordControls("routes", adminApi.routes, "route");

  const columns: DataTableColumn<AdminRouteSummary>[] = [
    {
      id: "route",
      header: "Route",
      cell: (route) => (
        <div className="min-w-44">
          <Link href={`/admin/routes/${route.id}`} className="font-medium hover:underline">
            {route.name}
          </Link>
          {route.route_number && (
            <Badge variant="secondary" className="ml-2">
              {route.route_number}
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: "journey",
      header: "Journey",
      cell: (route) => (
        <span className="flex items-center gap-1.5">
          {route.origin.name}
          <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-label="to" />
          {route.destination.name}
        </span>
      ),
    },
    { id: "stops", header: "Stops", className: "text-right", cell: (route) => route.stop_count },
    { id: "duration", header: "Duration", cell: (route) => formatDuration(route.duration_minutes) ?? "—" },
    { id: "fare", header: "Fare", className: "text-right", cell: (route) => (route.base_fare ? formatCurrency(route.base_fare) : "—") },
    { id: "trips", header: "Trips", className: "text-right", cell: (route) => route.trip_count },
    { id: "status", header: "Status", cell: (route) => <ActiveBadge active={route.active} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (route) => {
        const record = { id: route.id, label: route.name };
        return (
          <RowActions
            label={route.name}
            actions={[
              { label: "View", icon: <EyeIcon />, href: `/admin/routes/${route.id}` },
              { label: "Edit", icon: <PencilIcon />, href: `/admin/routes/${route.id}/edit` },
              route.active
                ? {
                    label: "Deactivate",
                    icon: <PowerOffIcon />,
                    onSelect: () => controls.requestDeactivate(record, "The route is hidden from passengers until you activate it again."),
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
        title="Routes"
        description="Paths between stops, with the timetable every trip on the route follows."
        actions={
          <Button asChild size="lg">
            <Link href="/admin/routes/new">
              <PlusIcon data-icon="inline-start" />
              New route
            </Link>
          </Button>
        }
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search name, number, town…"
          label="Search routes"
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
        caption="Routes"
        columns={columns}
        data={query.data?.results}
        getRowId={(route) => route.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={RouteIcon}
            title={list.isFiltered ? "No routes match" : "No routes yet"}
            description={list.isFiltered ? "Try a different search or clear the filters." : "Create a route by choosing its stops in order."}
            action={
              list.isFiltered ? (
                <Button variant="outline" onClick={list.reset}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/admin/routes/new">New route</Link>
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
          noun="route"
        />
      )}
      {controls.dialog}
    </div>
  );
}
