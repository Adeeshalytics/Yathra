import type { Metadata } from "next";

import { BusCreateView } from "@/components/admin/buses/bus-editor";

export const metadata: Metadata = { title: "Add bus" };

export default function NewBusPage() {
  return <BusCreateView />;
}
