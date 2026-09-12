import { CompassIcon } from "lucide-react";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site";

export default function NotFound() {
  return (
    <>
      <title>{`Page not found · ${siteConfig.name}`}</title>
      <SiteHeader />
      <main
        id="main-content"
        className="container-page flex flex-1 flex-col items-center justify-center gap-6 py-20 text-center"
      >
        <span className="grid size-16 place-items-center rounded-full bg-secondary text-primary">
          <CompassIcon className="size-8" aria-hidden />
        </span>
        <div className="space-y-3">
          <p className="font-heading text-6xl font-extrabold text-primary">404</p>
          <h1 className="text-3xl font-bold">This stop isn’t on our route map</h1>
          <p className="mx-auto max-w-md text-muted-foreground">
            The page you’re looking for doesn’t exist or may have moved.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="cta" size="xl">
            <Link href="/">Back to home</Link>
          </Button>
          <Button asChild variant="outline" size="xl">
            <Link href="/#popular-routes">See popular routes</Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
