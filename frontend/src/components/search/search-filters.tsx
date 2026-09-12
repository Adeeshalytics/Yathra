"use client";

import { MoonIcon, SunIcon, SunriseIcon, SunsetIcon } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BusType } from "@/lib/api/admin-types";
import type { SearchFacets } from "@/lib/api/trip-types";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BUS_TYPES } from "@/lib/validations/admin";
import {
  DEPARTURE_PERIODS,
  NO_FILTERS,
  activeFilterCount,
  type DeparturePeriod,
  type SearchFilters as Filters,
} from "@/lib/validations/search";

const PERIOD_ICONS: Record<DeparturePeriod, ComponentType<{ className?: string }>> = {
  early_morning: MoonIcon,
  morning: SunriseIcon,
  afternoon: SunIcon,
  evening: SunsetIcon,
};

const PRICE = /^\d{1,6}(\.\d{1,2})?$/;

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="space-y-3 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </div>
  );
}

function CheckOption({
  id,
  label,
  count,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  const empty = count === 0 && !checked;
  return (
    <div className={cn("flex items-center gap-2.5", empty && "opacity-50")}>
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} disabled={empty} />
      <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
        {label}
      </Label>
      {count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
    </div>
  );
}

function PriceRange({
  idPrefix,
  min,
  max,
  bounds,
  onApply,
}: {
  idPrefix: string;
  min: string;
  max: string;
  bounds?: SearchFacets["price"];
  onApply: (min: string, max: string) => void;
}) {
  const [low, setLow] = useState(min);
  const [high, setHigh] = useState(max);
  const lowValid = low === "" || PRICE.test(low);
  const highValid = high === "" || PRICE.test(high);
  const ordered = !low || !high || Number(low) <= Number(high);
  const problem = !lowValid || !highValid ? "Enter prices in rupees." : !ordered ? "Min can’t be above max." : null;

  const apply = () => {
    if (!problem && (low !== min || high !== max)) onApply(low, high);
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["min", "Min", low, setLow, bounds?.min],
            ["max", "Max", high, setHigh, bounds?.max],
          ] as const
        ).map(([key, label, value, setValue, hint]) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`${idPrefix}-price-${key}`} className="text-xs text-muted-foreground">
              {label} (LKR)
            </Label>
            <Input
              id={`${idPrefix}-price-${key}`}
              inputMode="decimal"
              value={value}
              placeholder={hint ? String(Math.round(Number(hint))) : ""}
              onChange={(event) => setValue(event.target.value.replace(/[^\d.]/g, ""))}
              onBlur={apply}
              aria-invalid={Boolean(problem)}
              className="h-9"
            />
          </div>
        ))}
      </div>
      {problem ? (
        <p className="text-xs text-destructive">{problem}</p>
      ) : (
        bounds?.min &&
        bounds.max && (
          <p className="text-xs text-muted-foreground">
            Fares this day: {formatCurrency(bounds.min)} – {formatCurrency(bounds.max)}
          </p>
        )
      )}
      <button type="submit" className="sr-only">
        Apply price range
      </button>
    </form>
  );
}

/** Filter panel for the results page. Counts come from the API's facets for the day. */
export function SearchFilters({
  facets,
  filters,
  onChange,
  idPrefix = "filters",
}: {
  facets?: SearchFacets;
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  idPrefix?: string;
}) {
  const active = activeFilterCount(filters);
  const busTypeCount = (value: BusType) => facets?.bus_types.find((item) => item.value === value)?.count;
  const periodCount = (value: string) => facets?.departure_periods.find((item) => item.value === value)?.count;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold">Filters</h2>
        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
            Clear all ({active})
          </Button>
        )}
      </div>

      <Section id={`${idPrefix}-departure`} title="Departure time">
        <div className="grid grid-cols-2 gap-2">
          {DEPARTURE_PERIODS.map((period) => {
            const Icon = PERIOD_ICONS[period.value];
            const on = filters.periods.includes(period.value);
            const count = periodCount(period.value);
            return (
              <button
                key={period.value}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ periods: toggle(filters.periods, period.value) })}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left text-xs transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50",
                  on && "border-primary bg-primary/5 text-primary",
                  count === 0 && !on && "opacity-50",
                )}
              >
                <Icon className="size-4" />
                <span className="font-medium text-foreground">{period.label}</span>
                <span className="text-muted-foreground">
                  {period.hours}
                  {count !== undefined && ` · ${count}`}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section id={`${idPrefix}-type`} title="Bus type">
        <div className="space-y-2.5">
          {BUS_TYPES.map((type) => (
            <CheckOption
              key={type.value}
              id={`${idPrefix}-type-${type.value}`}
              label={type.label}
              count={busTypeCount(type.value)}
              checked={filters.busTypes.includes(type.value)}
              onChange={() => onChange({ busTypes: toggle(filters.busTypes, type.value) })}
            />
          ))}
        </div>
      </Section>

      <Section id={`${idPrefix}-ac`} title="Air conditioning">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {(
            [
              ["", "Any", facets?.total],
              ["true", "AC", facets?.ac.ac],
              ["false", "Non-AC", facets?.ac.non_ac],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={label}
              type="button"
              aria-pressed={filters.ac === value}
              onClick={() => onChange({ ac: value })}
              className={cn(
                "rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                filters.ac === value && "bg-card text-foreground shadow-sm",
              )}
            >
              {label}
              {count !== undefined && <span className="ml-1 opacity-70">{count}</span>}
            </button>
          ))}
        </div>
      </Section>

      <Section id={`${idPrefix}-price`} title="Price per seat">
        <PriceRange
          key={`${filters.minPrice}|${filters.maxPrice}`}
          idPrefix={idPrefix}
          min={filters.minPrice}
          max={filters.maxPrice}
          bounds={facets?.price}
          onApply={(minPrice, maxPrice) => onChange({ minPrice, maxPrice })}
        />
      </Section>

      {facets && facets.operators.length > 0 && (
        <Section id={`${idPrefix}-operator`} title="Operator">
          <div className="space-y-2.5">
            {facets.operators.map((operator) => (
              <CheckOption
                key={operator.id}
                id={`${idPrefix}-operator-${operator.id}`}
                label={operator.name}
                count={operator.count}
                checked={filters.operators.includes(operator.id)}
                onChange={() => onChange({ operators: toggle(filters.operators, operator.id) })}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
