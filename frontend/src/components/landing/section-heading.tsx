import { cn } from "@/lib/utils";

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "left",
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("max-w-2xl space-y-3", align === "center" && "mx-auto text-center")}>
      <p className="text-sm font-semibold tracking-wider text-primary uppercase">{eyebrow}</p>
      <h2 id={id} className="text-3xl font-bold sm:text-4xl">
        {title}
      </h2>
      {description && <p className="text-lg text-muted-foreground">{description}</p>}
    </div>
  );
}
