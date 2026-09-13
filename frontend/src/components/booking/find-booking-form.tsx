"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2Icon, MessageSquareIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { ticketsApi } from "@/lib/api/endpoints";
import { applyApiErrors } from "@/lib/forms";
import { isValidPhone } from "@/lib/validations/phone";

export const findBookingSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(6, { error: "Enter your booking reference, e.g. YT7KQ2M9XH." })
    .max(32, { error: "That’s too long for a booking reference." }),
  phone: z
    .string()
    .trim()
    .min(1, { error: "Enter the mobile number used for the booking." })
    .refine(isValidPhone, { error: "Enter a valid phone number, e.g. 077 123 4567." }),
});

type FindBookingValues = z.infer<typeof findBookingSchema>;

/**
 * Lost the ticket SMS? Give the booking reference and a phone number on the booking, and we
 * text the ticket to that number. Nothing is shown here, so a reference alone reveals nothing.
 */
export function FindBookingForm() {
  const [answer, setAnswer] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FindBookingValues>({
    resolver: zodResolver(findBookingSchema),
    defaultValues: { reference: "", phone: "" },
  });
  const mutation = useMutation({
    mutationFn: (values: FindBookingValues) => ticketsApi.find(values.reference, values.phone),
    onSuccess: (body) => setAnswer(body.detail),
    onError: (error) => setFormError(applyApiErrors(error, form.setError, ["reference", "phone"])),
  });

  if (answer) {
    return (
      <div className="space-y-4">
        <Alert>
          <MessageSquareIcon />
          <AlertTitle>Check your messages</AlertTitle>
          <AlertDescription>{answer}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            setAnswer(null);
            form.reset();
          }}
        >
          Look up another booking
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={form.handleSubmit((values) => {
        setFormError(null);
        mutation.mutate(values);
      })}
    >
      {formError && (
        <Alert variant="destructive" className="bg-destructive/5">
          <TriangleAlertIcon />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <TextField
          control={form.control}
          name="reference"
          label="Booking reference"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="YT7KQ2M9XH"
          className="font-mono uppercase"
          description="It’s in your booking text message or e-mail."
        />
        <TextField
          control={form.control}
          name="phone"
          label="Mobile number on the booking"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="077 123 4567"
          description="Yours, or any passenger’s. We text the ticket to this number."
        />
      </FieldGroup>
      <Button type="submit" size="xl" className="w-full" disabled={mutation.isPending}>
        {mutation.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
        Text me my ticket
      </Button>
    </form>
  );
}
