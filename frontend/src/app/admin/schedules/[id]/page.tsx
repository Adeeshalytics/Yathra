import type { Metadata } from "next";

import { ScheduleDetail } from "@/components/admin/schedules/schedule-detail";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScheduleDetail id={id} />;
}
