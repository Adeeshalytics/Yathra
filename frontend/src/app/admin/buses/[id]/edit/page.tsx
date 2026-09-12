import type { Metadata } from "next";

import { BusEditView } from "@/components/admin/buses/bus-editor";

export const metadata: Metadata = { title: "Edit bus" };

export default async function EditBusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BusEditView id={id} />;
}
