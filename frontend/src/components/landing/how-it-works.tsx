import { ArmchairIcon, SearchIcon, TicketIcon } from "lucide-react";

import { SectionHeading } from "./section-heading";

const STEPS = [
  {
    icon: SearchIcon,
    title: "Search your journey",
    description: "Choose where you’re leaving from, where you’re going and when you want to travel.",
  },
  {
    icon: ArmchairIcon,
    title: "Pick your seat",
    description: "Compare departures, bus types and fares, then choose the seat you want.",
  },
  {
    icon: TicketIcon,
    title: "Pay and board",
    description: "Pay securely online and show your booking reference on your phone when you board.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="scroll-mt-20 border-y bg-secondary/50 py-16 sm:py-24"
    >
      <div className="container-page">
        <SectionHeading
          id="how-it-works-heading"
          eyebrow="How it works"
          title="Booked in three simple steps"
          description="No queues at the bus stand and no guessing whether a seat is free."
          align="center"
        />
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, description }, index) => (
            <li key={title} className="relative rounded-2xl bg-card p-6 shadow-sm ring-1 ring-foreground/5">
              <div className="flex items-center gap-4">
                <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
                  <Icon className="size-6" aria-hidden />
                </span>
                <span className="font-heading text-4xl font-extrabold text-primary/15" aria-hidden>
                  0{index + 1}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-bold">
                <span className="sr-only">Step {index + 1}: </span>
                {title}
              </h3>
              <p className="mt-2 text-muted-foreground">{description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
