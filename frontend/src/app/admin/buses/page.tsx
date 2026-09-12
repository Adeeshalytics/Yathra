import type { Metadata } from "next";

import { BusesList } from "@/components/admin/buses/buses-list";

export const metadata: Metadata = { title: "Buses" };

export default function BusesPage() {
  return <BusesList />;
}
