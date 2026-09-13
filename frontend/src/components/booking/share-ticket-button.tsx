"use client";

import { Share2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";

/**
 * Send the ticket's own link to whoever is travelling (WhatsApp, SMS…) with the phone's share
 * sheet, or copy it where there isn't one. The link opens without signing in.
 */
export function ShareTicketButton({ url, reference }: { url: string; reference: string }) {
  async function share() {
    const title = `${siteConfig.name} e-ticket ${reference}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: `${title}: `, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Ticket link copied. Anyone with the link can open this ticket.");
    } catch {
      toast.error("Couldn’t copy the link. Long-press it in your text message instead.");
    }
  }

  return (
    <Button variant="outline" size="lg" onClick={() => void share()}>
      <Share2Icon data-icon="inline-start" />
      Share ticket
    </Button>
  );
}
