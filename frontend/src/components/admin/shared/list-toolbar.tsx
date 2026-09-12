"use client";

import { SearchIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 pl-9"
      />
    </div>
  );
}

/** Unbound date input for list filters ("" = any date). */
export function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      title={label}
      className="h-10 w-full sm:w-44"
    />
  );
}

/** Search + filters row above an admin table. */
export function ListToolbar({
  children,
  isFiltered,
  onReset,
}: {
  children: ReactNode;
  isFiltered?: boolean;
  onReset?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {children}
      {isFiltered && onReset && (
        <Button variant="ghost" size="lg" onClick={onReset} className="self-start sm:self-auto">
          <XIcon data-icon="inline-start" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
