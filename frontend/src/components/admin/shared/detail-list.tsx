import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface DetailItem {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

/** Label/value pairs in a responsive two-column grid. */
export function DetailList({ items, className }: { items: DetailItem[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-5 text-sm sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0", item.wide && "sm:col-span-2")}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 font-medium break-words">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
