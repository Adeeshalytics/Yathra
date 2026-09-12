import { CreditCardIcon, HeadsetIcon, ShieldCheckIcon, SmartphoneIcon } from "lucide-react";

import { SectionHeading } from "./section-heading";

const REASONS = [
  {
    icon: ShieldCheckIcon,
    title: "Verified operators",
    description: "Every bus company is registered and approved before it can sell a single seat.",
  },
  {
    icon: CreditCardIcon,
    title: "Secure payments",
    description: "Checkout runs over encrypted connections and we never store your card details.",
  },
  {
    icon: SmartphoneIcon,
    title: "Tickets on your phone",
    description: "Your booking reference and passenger list are always a tap away — no printing.",
  },
  {
    icon: HeadsetIcon,
    title: "Local support",
    description: "Help from people who know the routes, in Sinhala, Tamil or English.",
  },
];

export function WhyChooseUs() {
  return (
    <section id="why-us" aria-labelledby="why-us-heading" className="scroll-mt-20 py-16 sm:py-24">
      <div className="container-page grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <SectionHeading
          id="why-us-heading"
          eyebrow="Why choose us"
          title="Travel the island with confidence"
          description="Built for Sri Lankan journeys — from early-morning expressway runs to overnight trips up north."
        />
        <ul className="grid gap-4 sm:grid-cols-2">
          {REASONS.map(({ icon: Icon, title, description }) => (
            <li key={title} className="rounded-2xl border bg-card p-6">
              <span className="grid size-11 place-items-center rounded-xl bg-saffron/20 text-[oklch(0.45_0.1_60)]">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-bold">{title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
