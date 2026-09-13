"use client";

import { MailIcon, SmartphoneIcon } from "lucide-react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UserRole } from "@/lib/api/types";
import { readPhoneProof } from "@/lib/auth/phone-proof";
import { postLoginPath } from "@/lib/auth/roles";

import { LoginForm } from "./login-form";
import { PhoneSignIn } from "./phone-sign-in";
import { RedirectIfAuthenticated } from "./require-auth";

type Method = "phone" | "email";

/** Staff sign in with their email; everyone else is offered the phone first. */
function defaultMethod(next?: string): Method {
  return next?.startsWith("/admin") || next?.startsWith("/operator") ? "email" : "phone";
}

const noSubscription = () => () => {};

/** Read from this tab's storage after hydration (the server never has it). */
function usePendingPhoneLink(version: number) {
  const raw = useSyncExternalStore(
    noSubscription,
    () => {
      const link = readPhoneProof();
      return link ? JSON.stringify(link) : "";
    },
    () => "",
  );
  // `version` re-reads after the phone tab saved a proof.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (raw ? readPhoneProof() : null), [raw, version]);
}

/** Sign in with a texted code, or with an email and password. */
export function LoginPanel({ next }: { next?: string }) {
  const [version, setVersion] = useState(0);
  // A code that met an account with a password earlier in this tab: finish linking it by email.
  const phoneLink = usePendingPhoneLink(version);
  const [chosen, setChosen] = useState<Method | null>(null);
  const method = chosen ?? (phoneLink ? "email" : defaultMethod(next));
  const setMethod = setChosen;
  const destination = useCallback((role: UserRole) => postLoginPath(role, next), [next]);

  return (
    <>
      <RedirectIfAuthenticated to={destination} />
      <Tabs value={method} onValueChange={(value) => setMethod(value as Method)} className="gap-6">
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="phone" className="h-full">
            <SmartphoneIcon data-icon="inline-start" />
            Phone number
          </TabsTrigger>
          <TabsTrigger value="email" className="h-full">
            <MailIcon data-icon="inline-start" />
            Email
          </TabsTrigger>
        </TabsList>
        <TabsContent value="phone">
          <PhoneSignIn
            onPasswordRequired={() => {
              setVersion((current) => current + 1);
              setMethod("email");
            }}
          />
        </TabsContent>
        <TabsContent value="email">
          <LoginForm next={next} phoneLink={phoneLink} />
        </TabsContent>
      </Tabs>
    </>
  );
}
