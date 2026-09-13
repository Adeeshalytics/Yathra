"use client";

import { Loader2Icon, MessageSquareIcon, PencilIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { authApi } from "@/lib/api/endpoints";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import type { PhoneCodeSent, User } from "@/lib/api/types";
import { savePhoneProof } from "@/lib/auth/phone-proof";
import { isValidPhone } from "@/lib/validations/phone";

/** Whole seconds left until `deadline` (a Date.now() timestamp), ticking down to zero. */
function useSecondsUntil(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [deadline]);
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - Math.min(now, deadline)) / 1000));
}

function retryAfter(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const wait = Number(error.details?.retry_after);
  return Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : 60;
}

interface OtpCredential {
  code: string;
}

export interface PhoneSignInProps {
  /** Called once the session has started. */
  onSignedIn?: (user: User, created: boolean) => void;
  /**
   * The number is already on an account with a password: the proof is saved for this tab, and
   * the customer should sign in with their email once. Without a handler, a link is shown.
   */
  onPasswordRequired?: (phone: string) => void;
  /** Where "sign in with your email" goes when there is no handler. */
  emailSignInHref?: string;
  submitLabel?: string;
}

/**
 * Sign in (or sign up — it's the same thing) with a phone number: we text a six-digit code and
 * the customer types it in. No password, no form to fill in.
 */
export function PhoneSignIn({
  onSignedIn,
  onPasswordRequired,
  emailSignInHref = "/login",
  submitLabel = "Text me a code",
}: PhoneSignInProps) {
  const { signInWithPhone } = useAuth();
  const id = useId();
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [sent, setSent] = useState<PhoneCodeSent | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [linkNeeded, setLinkNeeded] = useState(false);
  const [busy, setBusy] = useState<"sending" | "verifying" | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const resendIn = useSecondsUntil(resendAt);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setFormError(null);
    setPhoneError(null);
    if (!isValidPhone(phone.trim())) {
      setPhoneError("Enter a valid mobile number, e.g. 077 123 4567.");
      return;
    }
    setBusy("sending");
    try {
      const result = await authApi.requestPhoneCode(phone.trim());
      setSent(result);
      setCode("");
      setCodeError(null);
      setResendAt(Date.now() + result.resend_in * 1000);
    } catch (error) {
      const wait = retryAfter(error);
      if (wait !== null) {
        if (sent) setResendAt(Date.now() + wait * 1000);
        setFormError(`Please wait ${wait} seconds before asking for another code.`);
      } else if (error instanceof ApiError && error.fieldErrors.phone) {
        setPhoneError(error.fieldErrors.phone);
      } else {
        setFormError(getErrorMessage(error));
      }
    } finally {
      setBusy(null);
    }
  }

  const verify = useCallback(
    async (value: string) => {
      if (!sent || busy) return;
      setFormError(null);
      setCodeError(null);
      if (!/^\d{6}$/.test(value)) {
        setCodeError("Enter the 6-digit code we texted you.");
        return;
      }
      setBusy("verifying");
      try {
        const session = await signInWithPhone(sent.phone, value);
        onSignedIn?.(session.user, session.created);
      } catch (error) {
        if (error instanceof ApiError && error.code === "password_required") {
          const proof = error.details?.phone_proof;
          if (typeof proof === "string") savePhoneProof({ phone: sent.phone, proof });
          if (onPasswordRequired) onPasswordRequired(sent.phone);
          else setLinkNeeded(true);
        } else if (
          error instanceof ApiError &&
          (error.code === "code_expired" || error.code === "too_many_attempts")
        ) {
          setCode("");
          setResendAt(null);
          setCodeError(error.message);
        } else if (error instanceof ApiError && error.status === 400) {
          setCodeError(error.fieldErrors.code ?? error.message);
        } else {
          setFormError(getErrorMessage(error));
        }
      } finally {
        setBusy(null);
      }
    },
    [busy, onPasswordRequired, onSignedIn, sent, signInWithPhone],
  );

  // Android Chrome can read the code straight from the text message (WebOTP).
  useEffect(() => {
    if (!sent || typeof window === "undefined" || !("OTPCredential" in window)) return;
    const controller = new AbortController();
    const request = navigator.credentials.get({
      otp: { transport: ["sms"] },
      signal: controller.signal,
    } as CredentialRequestOptions) as Promise<OtpCredential | null>;
    request
      .then((credential) => {
        if (credential?.code) {
          setCode(credential.code);
          void verify(credential.code);
        }
      })
      .catch(() => {
        // The customer typed it, or the browser declined: nothing to do.
      });
    return () => controller.abort();
    // Once per code sent (each send is a new `sent` object).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent]);

  useEffect(() => {
    if (sent) codeInput.current?.focus();
  }, [sent]);

  if (linkNeeded) {
    return (
      <Alert>
        <MessageSquareIcon />
        <AlertDescription>
          <span>
            This number is already on an account that has a password.{" "}
            <Link href={emailSignInHref} className="font-semibold text-primary underline-offset-4 hover:underline">
              Sign in with your email
            </Link>{" "}
            once to link it — after that, a texted code is all you need.
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {formError && (
        <Alert variant="destructive" className="bg-destructive/5">
          <TriangleAlertIcon />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      {!sent ? (
        <form onSubmit={(event) => void sendCode(event)} noValidate className="space-y-4">
          <Field data-invalid={Boolean(phoneError)}>
            <FieldLabel htmlFor={`${id}-phone`}>Mobile number</FieldLabel>
            <Input
              id={`${id}-phone`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="077 123 4567"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              aria-invalid={Boolean(phoneError)}
              aria-describedby={phoneError ? `${id}-phone-error` : `${id}-phone-help`}
              className="h-11"
            />
            {phoneError ? (
              <FieldError id={`${id}-phone-error`} errors={[{ message: phoneError }]} />
            ) : (
              <FieldDescription id={`${id}-phone-help`}>
                We’ll text you a 6-digit code. No password needed.
              </FieldDescription>
            )}
          </Field>
          <Button type="submit" size="xl" className="w-full" disabled={busy !== null}>
            {busy === "sending" && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            {submitLabel}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void verify(code);
          }}
          noValidate
          className="space-y-4"
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span>
              We texted a code to <span className="font-semibold">{sent.masked_phone}</span>.
            </span>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => {
                setSent(null);
                setCode("");
                setCodeError(null);
                setFormError(null);
              }}
            >
              <PencilIcon data-icon="inline-start" />
              Change number
            </Button>
          </p>
          <Field data-invalid={Boolean(codeError)}>
            <FieldLabel htmlFor={`${id}-code`}>6-digit code</FieldLabel>
            <Input
              ref={codeInput}
              id={`${id}-code`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(digits);
                setCodeError(null);
                if (digits.length === 6) void verify(digits);
              }}
              aria-invalid={Boolean(codeError)}
              aria-describedby={codeError ? `${id}-code-error` : undefined}
              className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
            />
            {codeError && <FieldError id={`${id}-code-error`} errors={[{ message: codeError }]} />}
          </Field>
          <Button type="submit" size="xl" className="w-full" disabled={busy !== null}>
            {busy === "verifying" && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            Continue
          </Button>
          <p className="text-center text-sm text-muted-foreground" aria-live="polite">
            {resendIn > 0 ? (
              <>Didn’t get it? You can ask again in {resendIn}s.</>
            ) : (
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                disabled={busy !== null}
                onClick={() => void sendCode()}
              >
                Send a new code
              </Button>
            )}
          </p>
        </form>
      )}
    </div>
  );
}
