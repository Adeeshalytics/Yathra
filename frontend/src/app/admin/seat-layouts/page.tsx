import type { Metadata } from "next";

import { SeatLayoutsList } from "@/components/admin/seat-layouts/seat-layouts-list";

export const metadata: Metadata = { title: "Seat layouts" };

export default function SeatLayoutsPage() {
  return <SeatLayoutsList />;
}
