import type { Metadata } from "next";

import { ScheduleCreateView } from "@/components/admin/schedules/schedule-editor";

export const metadata: Metadata = { title: "New schedule" };

export default function NewSchedulePage() {
  return <ScheduleCreateView />;
}
