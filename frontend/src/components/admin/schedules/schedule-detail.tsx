"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarPlusIcon,
  Loader2Icon,
  PencilIcon,
  PowerIcon,
  PowerOffIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { DetailList } from "@/components/admin/shared/detail-list";
import {
  BackLink,
  DetailSkeleton,
  FormErrorAlert,
  RecordError,
} from "@/components/admin/shared/page-parts";
import { useRecordControls } from "@/components/admin/shared/record-controls";
import { TripStatusBadge } from "@/components/admin/trips/trip-status";
import { PageHeader } from "@/components/common/page-header";
import { ActiveBadge } from "@/components/common/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdminMutation } from "@/hooks/use-admin-mutation";
import { adminApi } from "@/lib/api/admin";
import type { AdminTripSchedule, GenerateTripsResult, OccurrenceResult } from "@/lib/api/admin-types";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { addDays, daysBetween, formatDay, formatTime, formatTripDate, sriLankaParts } from "@/lib/datetime";
import { formatCurrency, formatDate, formatDuration, pluralize, todayInSriLanka } from "@/lib/format";
import { cn } from "@/lib/utils";

import { periodLabel, runsLabel, scheduleLabel } from "./schedules-list";

interface DateRange {
  from: string;
  to: string;
}

const RESULTS: Record<OccurrenceResult, { label: string; className: string }> = {
  planned: { label: "Will be created", className: "border-sky-200 bg-sky-50 text-sky-800" },
  created: { label: "Created", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  exists: { label: "Already scheduled", className: "border-border bg-muted text-muted-foreground" },
  conflict: { label: "Bus unavailable", className: "border-amber-200 bg-amber-50 text-amber-900" },
  past: { label: "In the past", className: "border-border bg-muted text-muted-foreground" },
};

/** Two weeks, starting after whatever was generated last (and never before tomorrow). */
function defaultRange(schedule: AdminTripSchedule): DateRange {
  const tomorrow = addDays(todayInSriLanka(), 1);
  const resume = schedule.last_generated_until ? addDays(schedule.last_generated_until, 1) : tomorrow;
  const from = [tomorrow, schedule.start_date, resume].sort().at(-1) ?? tomorrow;
  const fortnight = addDays(from, 13);
  const to =
    schedule.end_date && schedule.end_date >= from && schedule.end_date < fortnight
      ? schedule.end_date
      : fortnight;
  return { from, to };
}

function problemMessages(error: unknown): string[] {
  if (error instanceof ApiError && error.details) {
    const messages = Object.values(error.details).flatMap((value) =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : typeof value === "string"
          ? [value]
          : [],
    );
    if (messages.length > 0) return messages;
  }
  return [getErrorMessage(error)];
}

function GenerationResult({ result }: { result: GenerateTripsResult }) {
  if (result.occurrences.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
        This schedule doesn’t run on any day in that range.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm" aria-live="polite">
        {result.dry_run ? (
          <>
            <strong>{pluralize(result.planned, "trip")}</strong> will be created
          </>
        ) : (
          <>
            <strong>{pluralize(result.created, "trip")}</strong> created
          </>
        )}
        {result.skipped > 0 && ` · ${result.skipped} skipped`}.
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-3">Date</TableHead>
              <TableHead className="px-3">Departs</TableHead>
              <TableHead className="px-3">Arrives</TableHead>
              <TableHead className="px-3">Result</TableHead>
              <TableHead className="px-3">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.occurrences.map((occurrence) => {
              const shift = daysBetween(occurrence.date, sriLankaParts(occurrence.arrival_datetime).date);
              const tone = RESULTS[occurrence.result];
              return (
                <TableRow key={occurrence.date}>
                  <TableCell className="px-3">{formatDay(occurrence.date)}</TableCell>
                  <TableCell className="px-3 tabular-nums">{formatTime(occurrence.departure_datetime)}</TableCell>
                  <TableCell className="px-3 tabular-nums">
                    {formatTime(occurrence.arrival_datetime)}
                    {shift > 0 && <span className="text-muted-foreground"> +{shift}d</span>}
                  </TableCell>
                  <TableCell className="px-3">
                    <Badge variant="outline" className={tone.className}>
                      {tone.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="min-w-56 px-3 whitespace-normal text-muted-foreground">
                    {occurrence.trip_id ? (
                      <Link href={`/admin/trips/${occurrence.trip_id}`} className="text-primary hover:underline">
                        {occurrence.detail}
                      </Link>
                    ) : (
                      occurrence.detail
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function GenerateTrips({ schedule }: { schedule: AdminTripSchedule }) {
  const [range, setRange] = useState<DateRange>(() => defaultRange(schedule));
  const [result, setResult] = useState<GenerateTripsResult | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const preview = useMutation({
    mutationFn: ({ from, to }: DateRange) =>
      adminApi.tripSchedules.generate(schedule.id, { from_date: from, to_date: to, dry_run: true }),
  });
  const generate = useAdminMutation({
    mutationFn: ({ from, to }: DateRange) =>
      adminApi.tripSchedules.generate(schedule.id, { from_date: from, to_date: to, dry_run: false }),
    successMessage: (outcome) =>
      outcome.created > 0
        ? `Created ${pluralize(outcome.created, "trip")}.`
        : "No new trips were needed — those days are already covered.",
    toastErrors: false,
  });
  const busy = preview.isPending || generate.isPending;

  async function run(dryRun: boolean) {
    setProblems([]);
    try {
      setResult(dryRun ? await preview.mutateAsync(range) : await generate.mutateAsync(range));
    } catch (error) {
      setResult(null);
      setProblems(problemMessages(error));
    }
  }

  function changeRange(next: Partial<DateRange>) {
    setRange((current) => ({ ...current, ...next }));
    setResult(null);
    setProblems([]);
  }

  return (
    <Card id="generate" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Generate trips</CardTitle>
        <CardDescription>
          Create the individual trips for a date range. Days that are already scheduled, in the
          past, or when the bus is busy are skipped, so it’s safe to run again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!schedule.active && (
          <Alert>
            <PowerOffIcon />
            <AlertDescription>Activate this schedule to generate trips from it.</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor="generate-from">From</Label>
            <Input
              id="generate-from"
              type="date"
              className="h-10"
              value={range.from}
              onChange={(event) => changeRange({ from: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="generate-to">To</Label>
            <Input
              id="generate-to"
              type="date"
              className="h-10"
              value={range.to}
              onChange={(event) => changeRange({ to: event.target.value })}
            />
          </div>
          <Button
            variant="outline"
            size="lg"
            className="h-10"
            disabled={busy || !schedule.active}
            onClick={() => void run(true)}
          >
            {preview.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            Preview
          </Button>
          <Button size="lg" className="h-10" disabled={busy || !schedule.active} onClick={() => void run(false)}>
            {generate.isPending ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <CalendarPlusIcon data-icon="inline-start" />
            )}
            Generate trips
          </Button>
        </div>
        <FormErrorAlert messages={problems} />
        {result && <GenerationResult result={result} />}
      </CardContent>
    </Card>
  );
}

function ScheduleTrips({ scheduleId }: { scheduleId: string }) {
  const params = { schedule: scheduleId, upcoming: "true", page_size: 8 };
  const trips = useQuery({
    queryKey: queryKeys.admin.list("trips", params),
    queryFn: ({ signal }) => adminApi.trips.list(params, signal),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming trips</CardTitle>
        <CardDescription>
          {trips.data ? `${pluralize(trips.data.count, "trip")} from this schedule` : "Loading…"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {trips.isPending ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : trips.isError ? (
          <p className="text-sm text-destructive">{getErrorMessage(trips.error)}</p>
        ) : trips.data.results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming trips yet — generate some above.</p>
        ) : (
          <ul className="divide-y text-sm">
            {trips.data.results.map((trip) => (
              <li key={trip.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link href={`/admin/trips/${trip.id}`} className="font-mono font-medium hover:underline">
                    {trip.code}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatTripDate(trip.departure_datetime)} · {formatTime(trip.departure_datetime)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {trip.available_seats} seats left
                  </span>
                  <TripStatusBadge status={trip.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ScheduleDetail({ id }: { id: string }) {
  const router = useRouter();
  const query = useQuery({
    queryKey: queryKeys.admin.detail("trip-schedules", id),
    queryFn: ({ signal }) => adminApi.tripSchedules.get(id, signal),
  });
  const controls = useRecordControls("trip-schedules", adminApi.tripSchedules, "schedule");

  if (query.isPending) return <DetailSkeleton />;
  if (query.isError) {
    return (
      <RecordError
        error={query.error}
        noun="schedule"
        backHref="/admin/schedules"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const schedule = query.data;
  const time = schedule.departure_time.slice(0, 5);
  const record = { id: schedule.id, label: scheduleLabel(schedule) };
  const linkClass = "text-primary hover:underline";
  const stats: { label: string; value: ReactNode; hint: string }[] = [
    { label: "Departs", value: time, hint: "Sri Lanka time" },
    {
      label: "Runs",
      value: runsLabel(schedule),
      hint: schedule.recurrence === "daily" ? "Every day" : "Selected weekdays",
    },
    { label: "Ticket price", value: formatCurrency(schedule.base_price), hint: "per seat" },
    { label: "Journey", value: formatDuration(schedule.duration_minutes) ?? "—", hint: "route timetable" },
    {
      label: "Upcoming trips",
      value: schedule.upcoming_trip_count,
      hint: `${schedule.trip_count} generated in total`,
    },
    {
      label: "Generated until",
      value: schedule.last_generated_until ? formatDay(schedule.last_generated_until, { year: false }) : "—",
      hint: schedule.last_generated_until ? "last date covered" : "Nothing generated yet",
    },
  ];

  return (
    <div className="space-y-6">
      <BackLink href="/admin/schedules">Schedules</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {schedule.route_summary.name}
            <Badge variant="secondary" className="tabular-nums">
              {time}
            </Badge>
            <ActiveBadge active={schedule.active} />
          </span>
        }
        description={`${runsLabel(schedule)} · ${schedule.bus_summary.registration_number} · ${schedule.operator_name}`}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <Link href={`/admin/schedules/${id}/edit`}>
                <PencilIcon data-icon="inline-start" />
                Edit
              </Link>
            </Button>
            {schedule.active ? (
              <Button
                variant="outline"
                size="lg"
                disabled={controls.isBusy}
                onClick={() =>
                  controls.requestDeactivate(
                    record,
                    "No new trips can be generated from it. Trips it already created keep running.",
                  )
                }
              >
                <PowerOffIcon data-icon="inline-start" />
                Deactivate
              </Button>
            ) : (
              <Button size="lg" disabled={controls.isBusy} onClick={() => controls.activate(record)}>
                <PowerIcon data-icon="inline-start" />
                Activate
              </Button>
            )}
            <Button
              variant="destructive"
              size="lg"
              disabled={controls.isBusy}
              onClick={() =>
                controls.requestDelete(record, {
                  description:
                    "This removes the schedule. Trips it already generated stay on the timetable as one-time trips.",
                  onDeleted: () => router.push("/admin/schedules"),
                })
              }
            >
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="font-heading text-xl font-bold tabular-nums">{stat.value}</p>
            <p className={cn("truncate text-xs text-muted-foreground")}>{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <div className="min-w-0 space-y-6">
          <GenerateTrips schedule={schedule} />
          <ScheduleTrips scheduleId={schedule.id} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              className="sm:grid-cols-1"
              items={[
                {
                  label: "Route",
                  value: (
                    <Link href={`/admin/routes/${schedule.route}`} className={linkClass}>
                      {schedule.route_summary.name}
                    </Link>
                  ),
                },
                {
                  label: "Bus",
                  value: (
                    <Link href={`/admin/buses/${schedule.bus}`} className={linkClass}>
                      {schedule.bus_summary.registration_number} · {schedule.bus_summary.name}
                    </Link>
                  ),
                },
                {
                  label: "Operator",
                  value: (
                    <Link href={`/admin/operators/${schedule.operator}`} className={linkClass}>
                      {schedule.operator_name}
                    </Link>
                  ),
                },
                { label: "Valid", value: periodLabel(schedule) },
                { label: "Created", value: formatDate(schedule.created_at) },
                { label: "Last updated", value: formatDate(schedule.updated_at) },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      {controls.dialog}
    </div>
  );
}
