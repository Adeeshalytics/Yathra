import { BusFrontIcon } from "lucide-react";
import Link from "next/link";

import { siteConfig } from "@/lib/site";
import { cn } from "@/lib/utils";

export function Logo({
  href = "/",
  tone = "default",
  className,
}: {
  href?: string;
  tone?: "default" | "inverse";
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${siteConfig.name} home`}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg font-heading text-lg font-extrabold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        tone === "inverse" ? "text-white" : "text-foreground",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-9 place-items-center rounded-xl shadow-sm",
          tone === "inverse" ? "bg-white/15 ring-1 ring-white/25" : "bg-primary text-primary-foreground",
        )}
      >
        <BusFrontIcon className="size-5" aria-hidden />
      </span>
      <span>
        {siteConfig.name}
        <span className="text-saffron">.</span>
      </span>
    </Link>
  );
}
