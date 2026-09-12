import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchExperience, SearchExperienceSkeleton } from "@/components/search/search-experience";

export const metadata: Metadata = { title: "Search buses" };

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchExperienceSkeleton />}>
      <SearchExperience />
    </Suspense>
  );
}
