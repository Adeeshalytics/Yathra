import type { Metadata } from "next";
import { Suspense } from "react";

import { PassengersList } from "@/components/admin/passengers/passengers-list";

export const metadata: Metadata = { title: "Passengers" };

export default function PassengersPage() {
  // useSearchParams (the trip / booking the list is pinned to) needs a Suspense boundary.
  return (
    <Suspense>
      <PassengersList />
    </Suspense>
  );
}
