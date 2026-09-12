"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CalendarPlusIcon,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  RepeatIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";

import { ListToolbar, SearchInput } from "@/components/admin/shared/list-toolbar";
import { PaginationBar } from "@/components/admin/shared/pagination-bar";
import { RowActions, useRecordControls } from "@/components/admin/shared/record-controls";
import {
  useBusOptions,
  useOperatorOptions,
  useRouteOptions,
} from "@/components/admin/trips/use-trip-options";
import { DataTable, type DataTableColumn } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badge";
import { FilterSelect } from "@/components/forms/select-field";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { adminApi } from "@/lib/api/admin";
import type { AdminTripSchedule } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { describeWeekdays, formatDay } from "@/lib/datetime";
import { formatCurrency, formatDuration } from "@/lib/format";
import { RECURRENCES } from "@/lib/validations/trips";

const STATUS_OPTIONS = [
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

export function runsLabel(schedule: Pick<AdminTripSchedule, "recurrence" | "weekdays">): string {
  return schedule.recurrence === "daily" ? "Daily" : describeWeekdays(schedule.weekdays);
}

export function periodLabel(schedule: Pick<AdminTripSchedule, "start_date" | "end_date">): string {
  return schedule.end_date
    ? `${formatDay(schedule.start_date)} – ${formatDay(schedule.end_date)}`
    : `From ${formatDay(schedule.start_date)}`;
}

export function scheduleLabel(schedule: AdminTripSchedule): string {
  return `${schedule.route_summary.name} at ${schedule.departure_time.slice(0, 5)}`;
}

export function SchedulesList() {
  const list = useListState({ route: "all", bus: "all", operator: "all", recurrence: "all", active: "all" });
  const query = useQuery({
    queryKey: queryKeys.admin.list("trip-schedules", list.params),
    queryFn: ({ signal }) => adminApi.tripSchedules.list(list.params, signal),
    placeholderData: keepPreviousData,
  });
  const routes = useRouteOptions();
  const buses = useBusOptions();
  const operators = useOperatorOptions();
  const controls = useRecordControls("trip-schedules", adminApi.tripSchedules, "schedule");

  const columns: DataTableColumn<AdminTripSchedule>[] = [
    {
      id: "route",
      header: "Route",
      cell: (schedule) => (
        <div className="min-w-44">
          <Link href={`/admin/schedules/${schedule.id}`} className="font-medium hover:underline">
            {schedule.route_summary.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {schedule.route_summary.origin.name} → {schedule.route_summary.destination.name}
          </p>
        </div>
      ),
    },
    {
      id: "bus",
      header: "Bus",
      cell: (schedule) => (
        <div className="min-w-32">
          <p className="font-mono text-sm">{schedule.bus_summary.registration_number}</p>
          <p className="max-w-40 truncate text-xs text-muted-foreground">{schedule.bus_summary.name}</p>
        </div>
      ),
    },
    { id: "operator", header: "Operator", cell: (schedule) => schedule.operator_name },
    {
      id: "departs",
      header: "Departs",
      cell: (schedule) => (
        <div className="tabular-nums">
          <p className="font-medium">{schedule.departure_time.slice(0, 5)}</p>
          <p className="text-xs text-muted-foreground">{formatDuration(schedule.duration_minutes) ?? "—"}</p>
        </div>
      ),
    },
    { id: "runs", header: "Runs", cell: (schedule) => runsLabel(schedule) },
    {
      id: "price",
      header: "Price",
      cell: (schedule) => <span className="tabular-nums">{formatCurrency(schedule.base_price)}</span>,
    },
    {
      id: "period",
      header: "Period",
      cell: (schedule) => <span className="whitespace-nowrap text-sm">{periodLabel(schedule)}</span>,
    },
    {
      id: "trips",
      header: "Upcoming trips",
      cell: (schedule) => <span className="tabular-nums">{schedule.upcoming_trip_count}</span>,
    },
    { id: "status", header: "Status", cell: (schedule) => <ActiveBadge active={schedule.active} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (schedule) => {
        const record = { id: schedule.id, label: scheduleLabel(schedule) };
        return (
          <RowActions
            label={record.label}
            actions={[
              { label: "View", icon: <EyeIcon />, href: `/admin/schedules/${schedule.id}` },
              { label: "Edit", icon: <PencilIcon />, href: `/admin/schedules/${schedule.id}/edit` },
              {
                label: "Generate trips",
                icon: <CalendarPlusIcon />,
                href: `/admin/schedules/${schedule.id}#generate`,
              },
              schedule.active
                ? {
                    label: "Deactivate",
                    icon: <PowerOffIcon />,
                    onSelect: () =>
                      controls.requestDeactivate(
                        record,
                        "No new trips can be generated from it. Trips it already created keep running.",
                      ),
                  }
                : { label: "Activate", icon: <PowerIcon />, onSelect: () => controls.activate(record) },
              {
                label: "Delete",
                icon: <Trash2Icon />,
                destructive: true,
                separatorBefore: true,
                onSelect: () =>
                  controls.requestDelete(record, {
                    description:
                      "This removes the schedule. Trips it already generated stay on the timetable as one-time trips.",
                  }),
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
        title="Schedules"
        description="Recurring timetables. Generate individual trips from them for any date range."
        actions={
          <Button asChild size="lg">
            <Link href="/admin/schedules/new">
              <PlusIcon data-icon="inline-start" />
              New schedule
            </Link>
          </Button>
        }
      />
      <ListToolbar isFiltered={list.isFiltered} onReset={list.reset}>
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder="Search route, plate, operator…"
          label="Search schedules"
        />
        <FilterSelect
          label="Route"
          value={list.filters.route}
          onChange={(value) => list.setFilter("route", value)}
          options={(routes.data?.results ?? []).map((route) => ({ value: route.id, label: route.name }))}
          className="sm:w-56"
        />
        <FilterSelect
          label="Bus"
          value={list.filters.bus}
          onChange={(value) => list.setFilter("bus", value)}
          options={(buses.data?.results ?? []).map((bus) => ({
            value: bus.id,
            label: `${bus.registration_number} · ${bus.name}`,
          }))}
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
          label="Runs"
          value={list.filters.recurrence}
          onChange={(value) => list.setFilter("recurrence", value)}
          options={RECURRENCES.map((option) => ({ ...option }))}
        />
        <FilterSelect
          label="Status"
          value={list.filters.active}
          onChange={(value) => list.setFilter("active", value)}
          options={STATUS_OPTIONS}
        />
      </ListToolbar>
      <DataTable
        caption="Recurring schedules"
        columns={columns}
        data={query.data?.results}
        getRowId={(schedule) => schedule.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyState={
          <EmptyState
            icon={RepeatIcon}
            title={list.isFiltered ? "No schedules match your filters" : "No schedules yet"}
            description={
              list.isFiltered
                ? "Try a different search or clear the filters."
                : "Set up a daily or weekly departure, then generate its trips."
            }
            action={
              list.isFiltered ? (
                <Button variant="outline" onClick={list.reset}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/admin/schedules/new">New schedule</Link>
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
          noun="schedule"
        />
      )}
      {controls.dialog}
    </div>
  );
}
