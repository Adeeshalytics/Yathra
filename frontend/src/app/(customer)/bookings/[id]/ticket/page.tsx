import type { Metadata } from "next";

import { TicketView } from "@/components/booking/ticket-view";

export const metadata: Metadata = { title: "Your e-ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketView id={id} />;
}
