import {
  ArmchairIcon,
  SnowflakeIcon,
  ToiletIcon,
  TvIcon,
  UsbIcon,
  WifiIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import type { BusFacility } from "@/lib/api/admin-types";
import { cn } from "@/lib/utils";
import { BUS_FACILITIES } from "@/lib/validations/admin";

export const FACILITY_ICONS: Record<BusFacility, ComponentType<{ className?: string }>> = {
  ac: SnowflakeIcon,
  wifi: WifiIcon,
  usb_charging: UsbIcon,
  reclining_seats: ArmchairIcon,
  tv: TvIcon,
  toilet: ToiletIcon,
};

const FACILITY_LABEL = Object.fromEntries(BUS_FACILITIES.map((f) => [f.value, f.label]));

/** Facilities as labelled badges, or (compact) as a row of icons with accessible names. */
export function FacilityList({
  facilities,
  compact = false,
  className,
}: {
  facilities: readonly BusFacility[];
  compact?: boolean;
  className?: string;
}) {
  if (facilities.length === 0) {
    return <span className="text-sm text-muted-foreground">None</span>;
  }
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {facilities.map((facility) => {
        const Icon = FACILITY_ICONS[facility];
        const label = FACILITY_LABEL[facility];
        return (
          <li key={facility}>
            {compact ? (
              <span
                title={label}
                className="grid size-7 place-items-center rounded-md bg-secondary text-primary"
              >
                <Icon className="size-3.5" />
                <span className="sr-only">{label}</span>
              </span>
            ) : (
              <Badge variant="secondary" className="h-6 gap-1.5 px-2.5">
                <Icon />
                {label}
              </Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}
