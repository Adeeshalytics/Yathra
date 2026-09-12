import type { Metadata } from "next";

import { RouteEditView } from "@/components/admin/routes/route-views";

export const metadata: Metadata = { title: "Edit route" };

export default async function EditRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RouteEditView id={id} />;
}
