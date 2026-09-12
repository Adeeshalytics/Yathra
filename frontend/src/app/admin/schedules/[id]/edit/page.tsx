import type { Metadata } from "next";

import { ScheduleEditView } from "@/components/admin/schedules/schedule-editor";

export const metadata: Metadata = { title: "Edit schedule" };

export default async function EditSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScheduleEditView id={id} />;
}
