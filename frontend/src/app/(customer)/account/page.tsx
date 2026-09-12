import type { Metadata } from "next";

import { AccountOverview } from "@/components/account/account-overview";

export const metadata: Metadata = { title: "My account" };

export default function AccountPage() {
  return <AccountOverview />;
}
