"use client";

import { DateFilter } from "@/components/admin/shared/list-toolbar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RangeKey } from "@/lib/api/report-types";

export interface DateRangeValue {
  range: RangeKey;
  date_from: string;
  date_to: string;
}

export const DEFAULT_RANGE: DateRangeValue = { range: "month", date_from: "", date_to: "" };

/** Shown until the catalogue arrives; the server is still the authority on what exists. */
const FALLBACK_RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom range" },
  { key: "all", label: "All time" },
];

/** The request params for a range — custom dates only travel with a custom range. */
export function rangeParams(value: DateRangeValue): Record<string, string> {
  if (value.range !== "custom") return { range: value.range };
  return {
    range: "custom",
    ...(value.date_from && { date_from: value.date_from }),
    ...(value.date_to && { date_to: value.date_to }),
  };
}

/** Today / Yesterday / This week / This month / Custom — the filter every report shares. */
export function DateRangeFilter({
  value,
  onChange,
  ranges,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  ranges: { key: RangeKey; label: string }[];
}) {
  const choices = ranges.length > 0 ? ranges : FALLBACK_RANGES;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Select
        value={value.range}
        onValueChange={(next) => onChange({ ...value, range: next as RangeKey })}
      >
        <SelectTrigger aria-label="Date range" className="h-10 w-full sm:w-48">
          <span className="text-muted-foreground">Period:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {choices.map((option) => (
            <SelectItem key={option.key} value={option.key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.range === "custom" && (
        <>
          <DateFilter
            label="From date"
            value={value.date_from}
            onChange={(next) => onChange({ ...value, date_from: next })}
          />
          <DateFilter
            label="To date"
            value={value.date_to}
            onChange={(next) => onChange({ ...value, date_to: next })}
          />
        </>
      )}
    </div>
  );
}
