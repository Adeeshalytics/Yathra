"use client";

import { useQuery } from "@tanstack/react-query";

import { OPERATOR_OPTION_PARAMS } from "@/components/admin/buses/bus-form";
import type { SelectOption } from "@/components/forms/select-field";
import { adminApi } from "@/lib/api/admin";
import type { AdminBus, AdminRouteSummary, BusBrief, RouteBrief } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";

export const OPTION_PARAMS = { page_size: 100 };

export function useRouteOptions() {
  return useQuery({
    queryKey: queryKeys.admin.list("routes", OPTION_PARAMS),
    queryFn: ({ signal }) => adminApi.routes.list(OPTION_PARAMS, signal),
  });
}

export function useBusOptions() {
  return useQuery({
    queryKey: queryKeys.admin.list("buses", OPTION_PARAMS),
    queryFn: ({ signal }) => adminApi.buses.list(OPTION_PARAMS, signal),
  });
}

export function useOperatorOptions() {
  return useQuery({
    queryKey: queryKeys.admin.list("operators", OPERATOR_OPTION_PARAMS),
    queryFn: ({ signal }) => adminApi.operators.list(OPERATOR_OPTION_PARAMS, signal),
  });
}

/** Active routes with a timetable; the record's current route always stays selectable. */
export function routeSelectOptions(routes: AdminRouteSummary[], current?: RouteBrief): SelectOption[] {
  const options: SelectOption[] = routes
    .filter((route) => route.active || route.id === current?.id)
    .map((route) => ({
      value: route.id,
      label: route.stop_count < 2 ? `${route.name} (no timetable)` : route.name,
      disabled: route.stop_count < 2 && route.id !== current?.id,
    }));
  if (current && !options.some((option) => option.value === current.id)) {
    options.unshift({ value: current.id, label: current.name });
  }
  return options;
}

/** Active buses; ones without a seat layout can't be scheduled. */
export function busSelectOptions(buses: AdminBus[], current?: BusBrief): SelectOption[] {
  const options: SelectOption[] = buses
    .filter((bus) => bus.active || bus.id === current?.id)
    .map((bus) => ({
      value: bus.id,
      label: `${bus.registration_number} · ${bus.name} (${bus.operator_name})`,
      disabled: !bus.seat_layout && bus.id !== current?.id,
    }));
  if (current && !options.some((option) => option.value === current.id)) {
    options.unshift({ value: current.id, label: `${current.registration_number} · ${current.name}` });
  }
  return options;
}
