"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import {
  DateRangeFilter,
  rangeParams,
  type DateRangeValue,
} from "@/components/admin/reports/date-range-filter";
import { ErrorState } from "@/components/common/error-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/lib/api/admin";
import { queryKeys } from "@/lib/api/query-keys";
import type { DashboardCharts, RangeKey } from "@/lib/api/report-types";
import { formatCalendarDate, formatCurrency } from "@/lib/format";

/**
 * The dashboard's charts, drawn as plain SVG.
 *
 * Everything plotted here is already aggregated by the database — one row per day — so the
 * browser never sees a booking, and the page stays the same size whatever the traffic.
 */

const CHART_WIDTH = 640;
const CHART_HEIGHT = 180;
const PADDING = { top: 12, right: 8, bottom: 22, left: 8 };

interface Point {
  label: string;
  value: number;
  caption: string;
}

function niceMax(values: number[]): number {
  const highest = Math.max(...values, 0);
  if (highest <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(highest));
  return Math.ceil(highest / magnitude) * magnitude;
}

/** Every nth label, so a month of days doesn't overlap. */
function labelStep(count: number): number {
  return Math.max(1, Math.ceil(count / 8));
}

function BarChart({ points, tone = "primary" }: { points: Point[]; tone?: "primary" | "danger" }) {
  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nothing in this period.</p>;
  }
  const max = niceMax(points.map((point) => point.value));
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const slot = plotWidth / points.length;
  const barWidth = Math.max(2, Math.min(28, slot * 0.65));
  const step = labelStep(points.length);
  const fill = tone === "danger" ? "fill-red-400" : "fill-primary";

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="h-44 w-full"
      role="img"
      aria-label={`Bar chart: ${points.length} days, highest ${max}`}
      preserveAspectRatio="none"
    >
      <line
        x1={PADDING.left}
        y1={PADDING.top + plotHeight}
        x2={CHART_WIDTH - PADDING.right}
        y2={PADDING.top + plotHeight}
        className="stroke-border"
        strokeWidth={1}
      />
      {points.map((point, index) => {
        const height = max === 0 ? 0 : (point.value / max) * plotHeight;
        const x = PADDING.left + index * slot + (slot - barWidth) / 2;
        return (
          <g key={point.label}>
            <rect
              x={x}
              y={PADDING.top + plotHeight - height}
              width={barWidth}
              height={Math.max(height, point.value > 0 ? 2 : 0)}
              rx={2}
              className={fill}
            >
              <title>{point.caption}</title>
            </rect>
            {index % step === 0 && (
              <text
                x={x + barWidth / 2}
                y={CHART_HEIGHT - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {point.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nothing in this period.</p>;
  }
  const max = niceMax(points.map((point) => point.value));
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const xAt = (index: number) =>
    PADDING.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yAt = (value: number) => PADDING.top + plotHeight - (value / max) * plotHeight;
  const line = points.map((point, index) => `${xAt(index)},${yAt(point.value)}`).join(" ");
  const area = `${PADDING.left},${PADDING.top + plotHeight} ${line} ${xAt(points.length - 1)},${PADDING.top + plotHeight}`;
  const step = labelStep(points.length);

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="h-44 w-full"
      role="img"
      aria-label={`Line chart: ${points.length} days, highest ${max}`}
    >
      <polygon points={area} className="fill-primary/10" />
      <polyline
        points={line}
        fill="none"
        className="stroke-primary"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {points.map((point, index) => (
        <g key={point.label}>
          <circle cx={xAt(index)} cy={yAt(point.value)} r={2.5} className="fill-primary">
            <title>{point.caption}</title>
          </circle>
          {index % step === 0 && (
            <text
              x={xAt(index)}
              y={CHART_HEIGHT - 6}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {point.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function TopRoutes({ routes }: { routes: DashboardCharts["top_routes"] }) {
  if (routes.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No routes sold yet.</p>;
  }
  const most = Math.max(...routes.map((route) => Number(route.net)), 1);
  return (
    <ol className="space-y-3">
      {routes.map((route) => (
        <li key={route.route_id} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{route.route_name}</span>
            <span className="shrink-0 tabular-nums">{formatCurrency(route.net)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max((Number(route.net) / most) * 100, 2)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {route.bookings} bookings · {route.seats_sold} seats · {route.occupancy}% full
          </p>
        </li>
      ))}
    </ol>
  );
}

/** "2026-09-12" → "12 Sep" for an axis label. */
function shortDay(isoDate: string): string {
  return new Intl.DateTimeFormat("en-LK", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ChartGrid({ charts }: { charts: DashboardCharts }) {
  const bookings: Point[] = charts.bookings.map((day) => ({
    label: shortDay(day.date),
    value: day.bookings,
    caption: `${formatCalendarDate(day.date)}: ${day.bookings} bookings, ${day.seats} seats`,
  }));
  const revenue: Point[] = charts.revenue.map((day) => ({
    label: shortDay(day.date),
    value: Number(day.net),
    caption: `${formatCalendarDate(day.date)}: ${formatCurrency(day.net)} net`,
  }));
  const cancellations: Point[] = charts.cancellations.map((day) => ({
    label: shortDay(day.date),
    value: day.cancellations,
    caption: `${formatCalendarDate(day.date)}: ${day.cancellations} cancelled`,
  }));
  const occupancy: Point[] = charts.occupancy.by_date.map((day) => ({
    label: shortDay(day.date),
    value: day.occupancy,
    caption: `${formatCalendarDate(day.date)}: ${day.occupancy}% (${day.seats_sold} of ${day.capacity})`,
  }));

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Daily bookings" description="Bookings made each day, and the seats on them.">
        <BarChart points={bookings} />
      </ChartCard>
      <ChartCard title="Daily revenue" description="Takings after refunds, by the day the money arrived.">
        <LineChart points={revenue} />
      </ChartCard>
      <ChartCard title="Occupancy" description="Seats sold against capacity on the day each trip runs.">
        <BarChart points={occupancy} />
      </ChartCard>
      <ChartCard title="Cancellations" description="Bookings cancelled each day.">
        <BarChart points={cancellations} tone="danger" />
      </ChartCard>
      <ChartCard title="Top routes" description="The best-earning routes in this period.">
        <TopRoutes routes={charts.top_routes} />
      </ChartCard>
    </div>
  );
}

function Totals({ charts }: { charts: DashboardCharts }) {
  const cards = [
    { label: "Bookings", value: String(charts.totals.bookings) },
    { label: "Net revenue", value: formatCurrency(charts.totals.net_revenue) },
    { label: "Gross revenue", value: formatCurrency(charts.totals.gross_revenue) },
    {
      label: "Occupancy",
      value: `${charts.totals.occupancy}%`,
      hint: `${charts.totals.seats_sold} of ${charts.totals.capacity} seats`,
    },
    { label: "Cancellations", value: String(charts.totals.cancellations) },
  ];
  return (
    <dl role="group" aria-label="Trading totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="space-y-1">
            <dt className="text-sm text-muted-foreground">{card.label}</dt>
            <dd className="font-heading text-2xl font-bold tabular-nums">{card.value}</dd>
            {card.hint && <p className="text-xs text-muted-foreground">{card.hint}</p>}
          </CardContent>
        </Card>
      ))}
    </dl>
  );
}

// Every series is a row per day, so "All time" has nothing to plot: the dashboard leaves it out.
const CHART_RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom range" },
];

/** The trading section of the admin dashboard: totals, then the charts, for a chosen period. */
export function TradingCharts() {
  const [range, setRange] = useState<DateRangeValue>({
    range: "month",
    date_from: "",
    date_to: "",
  });
  const params = rangeParams(range);
  const query = useQuery({
    queryKey: queryKeys.admin.charts(params),
    queryFn: ({ signal }) => adminApi.charts(params, signal),
  });

  return (
    <section aria-label="Trading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold">Trading</h2>
          <p className="text-sm text-muted-foreground">
            {query.data ? query.data.range.label : "Bookings, takings, occupancy and cancellations."}
          </p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} ranges={CHART_RANGES} />
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-24 rounded-2xl" />
            ))}
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-64 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <Totals charts={query.data} />
          <ChartGrid charts={query.data} />
        </>
      )}
    </section>
  );
}
