import type { Metadata } from "next";

import { SchedulesList } from "@/components/admin/schedules/schedules-list";

export const metadata: Metadata = { title: "Schedules" };

export default function SchedulesPage() {
  return <SchedulesList />;
}
