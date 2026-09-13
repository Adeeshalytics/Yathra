"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2Icon, HourglassIcon, MailIcon, MapPinIcon, PhoneIcon, ShieldOffIcon } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { operatorApi } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { OperatorProfile } from "@/lib/api/types";
import { formatDate } from "@/lib/format";

/** The signed-in operator's company and their role in it (cached for the whole portal). */
export function useOperatorProfile() {
  return useQuery({
    queryKey: queryKeys.operatorProfile,
    queryFn: ({ signal }) => operatorApi.profile(signal),
    staleTime: 5 * 60 * 1000,
  });
}

export function canSeeRevenue(profile: OperatorProfile | undefined): boolean {
  return profile?.role === "owner" || profile?.role === "manager";
}

function CompanyDetails({ profile }: { profile: OperatorProfile }) {
  const { operator } = profile;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Company details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Registration number</dt>
            <dd className="mt-1 font-medium">{operator.registration_number}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Partner since</dt>
            <dd className="mt-1 font-medium">{formatDate(operator.created_at)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <MailIcon className="size-4" aria-hidden /> Email
            </dt>
            <dd className="mt-1 font-medium">{operator.contact_email}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <PhoneIcon className="size-4" aria-hidden /> Phone
            </dt>
            <dd className="mt-1 font-medium">{operator.contact_phone}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <MapPinIcon className="size-4" aria-hidden /> Address
            </dt>
            <dd className="mt-1 font-medium whitespace-pre-line">{operator.address}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * Every operator page sits behind this: a company must be linked and approved before its trips
 * and bookings can be shown. (The API enforces the same rule; this only explains it kindly.)
 */
export function OperatorGate({ children }: { children: ReactNode }) {
  const profile = useOperatorProfile();

  if (profile.isPending) {
    return (
      <div className="space-y-6" aria-busy>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }
  if (profile.isError) {
    if (profile.error instanceof ApiError && profile.error.status === 404) {
      return (
        <EmptyState
          icon={Building2Icon}
          title="No company linked yet"
          description="Your account isn’t attached to a bus company. Ask your company owner or our support team to add you."
        />
      );
    }
    return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  }

  const { operator, role } = profile.data;
  if (operator.status === "active") return <>{children}</>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={operator.company_name}
        description={`You’re signed in as ${role === "owner" ? "the owner" : `a ${role}`} of this company.`}
        actions={<StatusBadge status={operator.status} className="h-7 px-3 text-sm" />}
      />
      {operator.status === "pending" ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <HourglassIcon />
          <AlertTitle>Awaiting approval</AlertTitle>
          <AlertDescription className="text-amber-900/80">
            Our team is reviewing your registration. Your trips, bookings and takings appear here
            once your company is approved.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive" className="bg-destructive/5">
          <ShieldOffIcon />
          <AlertTitle>Account suspended</AlertTitle>
          <AlertDescription>
            Your company’s account is suspended, so its trips and bookings can’t be shown. Please
            contact our support team.
          </AlertDescription>
        </Alert>
      )}
      <CompanyDetails profile={profile.data} />
    </div>
  );
}
