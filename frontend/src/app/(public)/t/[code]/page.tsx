import type { Metadata } from "next";

import { SharedTicketView } from "@/components/booking/shared-ticket-view";

export const metadata: Metadata = {
  title: "Your e-ticket",
  // The link is a secret: keep it out of search engines and out of referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharedTicketPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <div className="container-page flex flex-1 flex-col py-6 sm:py-10">
      <SharedTicketView code={code} />
    </div>
  );
}
