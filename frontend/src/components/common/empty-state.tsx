import { InboxIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-card/60 px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-full bg-secondary text-secondary-foreground"
      >
        <Icon className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold">{title}</h3>
        {description && (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
