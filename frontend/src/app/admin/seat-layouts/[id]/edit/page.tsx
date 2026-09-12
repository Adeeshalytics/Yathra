import type { Metadata } from "next";

import { SeatLayoutEditView } from "@/components/admin/seat-layouts/seat-layout-views";

export const metadata: Metadata = { title: "Edit seat layout" };

export default async function EditSeatLayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SeatLayoutEditView id={id} />;
}
