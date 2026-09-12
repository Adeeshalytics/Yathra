"use client";

import { useState } from "react";

import type { ListParams } from "@/lib/api/admin";

import { useDebouncedValue } from "./use-debounced-value";

/**
 * Search + filters + page for an admin table. Any change to search or a filter jumps back to
 * page 1. Filters equal to "all" (or "") are left out of the request.
 */
export function useListState<F extends Record<string, string>>(defaultFilters: F) {
  const [search, setSearchValue] = useState("");
  const [filters, setFilters] = useState<F>(defaultFilters);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const params: ListParams = { page };
  if (debouncedSearch) params.search = debouncedSearch;
  for (const [key, value] of Object.entries(filters)) {
    if (value && value !== "all") params[key] = value;
  }

  const isFiltered =
    search.trim() !== "" ||
    Object.entries(filters).some(([key, value]) => value !== defaultFilters[key]);

  return {
    search,
    setSearch: (value: string) => {
      setSearchValue(value);
      setPage(1);
    },
    filters,
    setFilter: (key: keyof F, value: string) => {
      setFilters((current) => ({ ...current, [key]: value }));
      setPage(1);
    },
    page,
    setPage,
    params,
    isFiltered,
    reset: () => {
      setSearchValue("");
      setFilters(defaultFilters);
      setPage(1);
    },
  };
}
