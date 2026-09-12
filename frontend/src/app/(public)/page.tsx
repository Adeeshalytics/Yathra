import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { PopularRoutes } from "@/components/landing/popular-routes";
import { WhyChooseUs } from "@/components/landing/why-choose-us";

export default function HomePage() {
  return (
    <>
      <Hero />
      <PopularRoutes />
      <HowItWorks />
      <WhyChooseUs />
    </>
  );
}
