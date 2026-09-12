import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONE_CLASSES = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-border bg-muted text-muted-foreground",
} as const;

const STATUS_TONE: Record<string, keyof typeof TONE_CLASSES> = {
  active: "success",
  confirmed: "success",
  scheduled: "success",
  successful: "success",
  valid: "success",
  applied: "success",
  pending: "warning",
  payment_pending: "warning",
  processing: "warning",
  partially_refunded: "warning",
  boarding: "warning",
  suspended: "danger",
  cancelled: "danger",
  failed: "danger",
  rejected: "danger",
  expired: "neutral",
  completed: "neutral",
  used: "neutral",
  departed: "neutral",
  refunded: "neutral",
  ignored: "neutral",
  inactive: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending approval",
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  /** Overrides the default wording (e.g. the API's own status label). */
  label?: string;
  className?: string;
}) {
  const tone = TONE_CLASSES[STATUS_TONE[status] ?? "neutral"];
  return (
    <Badge variant="outline" className={cn(!label && "capitalize", tone, className)}>
      {label ?? STATUS_LABEL[status] ?? status.replace(/_/g, " ")}
    </Badge>
  );
}

/** Active / Inactive badge for records with a boolean `active` flag. */
export function ActiveBadge({ active, className }: { active: boolean; className?: string }) {
  return <StatusBadge status={active ? "active" : "inactive"} className={className} />;
}
