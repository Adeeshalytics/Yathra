import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <Loader2Icon className="size-5 animate-spin text-primary" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
    >
      <Loader2Icon className="size-7 animate-spin text-primary" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
