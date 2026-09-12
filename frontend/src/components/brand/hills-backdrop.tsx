import { cn } from "@/lib/utils";

/** Decorative rolling hills with a dashed road — a nod to the hill-country bus routes. */
export function HillsBackdrop({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1440 320"
      preserveAspectRatio="none"
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full text-white sm:h-56",
        className,
      )}
    >
      <path
        fill="currentColor"
        fillOpacity="0.07"
        d="M0 210C180 150 320 110 480 140c160 30 280 100 480 80s320-90 480-70v170H0Z"
      />
      <path
        fill="currentColor"
        fillOpacity="0.1"
        d="M0 262c200-42 360-62 560-32s340 60 540 40c160-16 260-40 340-44v94H0Z"
      />
      <path
        d="M0 300c300-15 600 10 900-4 250-11 400-4 540-8"
        fill="none"
        stroke="var(--saffron)"
        strokeOpacity="0.6"
        strokeWidth="3"
        strokeDasharray="18 14"
      />
    </svg>
  );
}
