import type { Metadata } from "next";

import { SeatLayoutCreateView } from "@/components/admin/seat-layouts/seat-layout-views";

export const metadata: Metadata = { title: "New seat layout" };

export default function NewSeatLayoutPage() {
  return <SeatLayoutCreateView />;
}
