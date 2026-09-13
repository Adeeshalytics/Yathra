"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2Icon, MapPinIcon, PlusIcon } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { adminApi } from "@/lib/api/admin";
import type { StopBrief } from "@/lib/api/admin-types";
import { queryKeys } from "@/lib/api/query-keys";
import { cn } from "@/lib/utils";

/** Searchable stop chooser (server-side search, keyboard navigable). */
export function StopPicker({
  excludeIds,
  onSelect,
  label = "Add stop",
}: {
  excludeIds: readonly string[];
  onSelect: (stop: StopBrief) => void;
  label?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const debounced = useDebouncedValue(search.trim(), 250);
  const params = { search: debounced || undefined, active: "true", page_size: 20, ordering: "name" };

  const query = useQuery({
    queryKey: queryKeys.admin.list("stops", params),
    queryFn: ({ signal }) => adminApi.stops.list(params, signal),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const options = (query.data?.results ?? []).filter((stop) => !excludeIds.includes(stop.id));
  const highlighted = Math.min(activeIndex, Math.max(options.length - 1, 0));

  const choose = (stop: StopBrief) => {
    // The coordinates travel with the choice: the route editor maps the stop straight away.
    onSelect({
      id: stop.id,
      name: stop.name,
      city: stop.city,
      active: stop.active,
      latitude: stop.latitude,
      longitude: stop.longitude,
    });
    setOpen(false);
    setSearch("");
    setActiveIndex(0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(highlighted + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(highlighted - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (options[highlighted]) choose(options[highlighted]);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="lg">
          <PlusIcon data-icon="inline-start" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options[highlighted] ? `${listId}-${options[highlighted].id}` : undefined}
          aria-label="Search stops"
          placeholder="Search stops or cities…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          className="h-10"
        />
        <ul id={listId} role="listbox" aria-label="Stops" className="max-h-64 overflow-y-auto">
          {query.isPending && (
            <li className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
              Loading stops…
            </li>
          )}
          {!query.isPending && options.length === 0 && (
            <li className="px-2 py-3 text-sm text-muted-foreground">No matching active stops.</li>
          )}
          {options.map((stop, index) => (
            <li
              key={stop.id}
              id={`${listId}-${stop.id}`}
              role="option"
              aria-selected={index === highlighted}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(stop)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm",
                index === highlighted && "bg-accent text-accent-foreground",
              )}
            >
              <MapPinIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{stop.name}</span>
              {stop.city !== stop.name && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{stop.city}</span>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
