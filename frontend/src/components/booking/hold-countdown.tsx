"use client";

import { TimerIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { currentTime } from "@/lib/clock";
import { formatCountdown } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/**
 * Milliseconds left on a server-side hold. Uses the server's `seconds_remaining` measured from
 * when the response arrived, so a wrong clock on the device can't shorten or stretch it.
 * Returns null when there is no hold.
 */
export function useCountdown(secondsRemaining: number | null | undefined, receivedAt: number): number | null {
  const [now, setNow] = useState(currentTime);
  const active = secondsRemaining !== null && secondsRemaining !== undefined;

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(currentTime()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;
  return Math.max(0, receivedAt + secondsRemaining * 1000 - Math.max(now, receivedAt));
}

export function HoldTimer({ remainingMs, className }: { remainingMs: number; className?: string }) {
  const urgent = remainingMs < 60_000;
  return (
    <span
      role="timer"
      aria-label={`${formatCountdown(remainingMs)} left to finish booking`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums",
        urgent ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-900",
        className,
      )}
    >
      <TimerIcon className="size-4" aria-hidden />
      {formatCountdown(remainingMs)}
    </span>
  );
}
