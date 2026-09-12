"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MapPinIcon, PencilIcon, PlusIcon, PowerIcon, PowerOffIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { RowActions, useRecordControls } from "@/components/admin/shared/record-controls";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { useListState } from "@/hooks/use-list-state";
import { adminApi } from "@/lib/api/admin";
import type { AdminStop, StopPayload } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";

import { StopForm } from "./stop-form";

type Editing = { mode: "create" } | { mode: "edit"; stop: AdminStop } | null;

export function StopsManager() {
  const list = useListState({ city: "all", active: "all" });
  const [editing, setEditing] = useState<Editing>(null);
  const query = useQuery({
    queryKey: queryKeys.admin.list("stops", list.params),
    queryFn: ({ signal }) => adminApi.stops.list(list.params, signal),
    placeholderData: keepPreviousData,
  });
  const cities = useQuery({
    queryKey: queryKeys.admin.cities,
    queryFn: ({ signal }) => adminApi.stops.cities(signal),
  });
  const controls = useRecordControls("stops", adminApi.stops, "stop");
  const save = useAdminMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: StopPayload }) =>
      id ? adminApi.stops.update(id, payload) : adminApi.stops.create(payload),
    successMessage: (stop, { id }) => (id ? `${stop.name} was updated.` : `${stop.name} was added.`),
    toastErrors: false,
    onSuccess: () => setEditing(null),
  });

  const columns: DataTableColumn<AdminStop>[] = [
    { id: "name", header: "Stop", cell: (stop) => <span className="font-medium">{stop.name}</span> },
    { id: "city", header: "City", cell: (stop) => stop.city },
    {
      id: "coordinates",
      header: "Coordinates",
      cell: (stop) =>
        stop.latitude && stop.longitude ? (
          <a
            href={`https://www.openstreetmap.org/?mlat=${stop.latitude}&mlon=${stop.longitude}#map=16/${stop.latitude}/${stop.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-primary hover:underline"
          >
            {Number(stop.latitude).toFixed(4)}, {Number(stop.longitude).toFixed(4)}
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: "routes", header: "Routes", className: "text-right", cell: (stop) => stop.route_count },
    { id: "status", header: "Status", cell: (stop) => <ActiveBadge active={stop.active} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (stop) => {
        const record = { id: stop.id, label: stop.name };
        return (
          <RowActions
            label={stop.name}
            actions={[
              { label: "Edit", icon: <PencilIcon />, onSelect: () => setEditing({ mode: "edit", stop }) },
              stop.active
                ? {
                    label: "Deactivate",
                    icon: <PowerOffIcon />,
                    onSelect: () =>
                      controls.requestDeactivate(
                        record,
                        stop.route_count > 0
                          ? `It stays on the ${stop.route_count} route(s) that use it, but can’t be added to new ones or chosen by passengers.`
                          : undefined,
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

  const editingStop = editing?.mode === "edit" ? editing.stop : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stops"
        description="Bus stands and towns that routes pass through."
        actions={
          <Button size="lg" onClick={() => setEditing({ mode: "create" })}>
            <PlusIcon data-icon="inline-start" />
            Add stop
          </Button>
        }
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search stops or cities…" label="Search stops" />
        <FilterSelect
          label="City"
          value={list.filters.city}
          onChange={(value) => list.setFilter("city", value)}
          options={(cities.data ?? []).map((city) => ({ value: city, label: city }))}
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
        caption="Stops"
        columns={columns}
        data={query.data?.results}
        getRowId={(stop) => stop.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={MapPinIcon}
            title={list.isFiltered ? "No stops match" : "No stops yet"}
            description={list.isFiltered ? "Try a different search or clear the filters." : "Add the bus stands your routes pass through."}
            action={
              list.isFiltered ? (
                <Button variant="outline" onClick={list.reset}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={() => setEditing({ mode: "create" })}>Add stop</Button>
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
          noun="stop"
        />
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && !save.isPending && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingStop ? `Edit ${editingStop.name}` : "Add stop"}</DialogTitle>
            <DialogDescription>
              {editingStop && editingStop.route_count > 0
                ? `Used by ${editingStop.route_count} route(s). Changes show everywhere it’s used.`
                : "Stops can be added to any route once saved."}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <StopForm
              key={editingStop?.id ?? "new"}
              stop={editingStop}
              cities={cities.data ?? []}
              submitLabel={editingStop ? "Save stop" : "Add stop"}
              onSubmit={(payload) => save.mutateAsync({ id: editingStop?.id, payload })}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {controls.dialog}
    </div>
  );
}
