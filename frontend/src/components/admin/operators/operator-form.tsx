"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormActions, FormErrorAlert } from "@/components/admin/shared/page-parts";
import { SelectField } from "@/components/forms/select-field";
import { TextField } from "@/components/forms/text-field";
import { TextareaField } from "@/components/forms/textarea-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import type { AdminOperator, OperatorPayload } from "@/lib/api/admin-types";
import { applyApiErrors } from "@/lib/forms";
import {
  OPERATOR_STATUSES,
  operatorSchema,
  toOperatorPayload,
  type OperatorFormValues,
} from "@/lib/validations/admin";

const FIELDS = [
  "company_name",
  "registration_number",
  "contact_phone",
  "contact_email",
  "address",
  "status",
] as const;

export function OperatorForm({
  operator,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  operator?: AdminOperator;
  submitLabel: string;
  onSubmit: (payload: OperatorPayload) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<OperatorFormValues>({
    resolver: zodResolver(operatorSchema),
    defaultValues: {
      company_name: operator?.company_name ?? "",
      registration_number: operator?.registration_number ?? "",
      contact_phone: operator?.contact_phone ?? "",
      contact_email: operator?.contact_email ?? "",
      address: operator?.address ?? "",
      status: operator?.status ?? "pending",
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(toOperatorPayload(values));
    } catch (error) {
      setFormError(applyApiErrors(error, form.setError, FIELDS));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FormErrorAlert messages={formError ? [formError] : []} />
      <Card>
        <CardHeader>
          <CardTitle>Company</CardTitle>
          <CardDescription>Legal details used on tickets and payouts.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-5 md:grid-cols-2">
            <TextField
              control={form.control}
              name="company_name"
              label="Company name"
              placeholder="Lanka Express Lines (Pvt) Ltd"
              autoComplete="organization"
            />
            <TextField
              control={form.control}
              name="registration_number"
              label="Business registration number"
              placeholder="PV-00012345"
              className="uppercase"
            />
            <SelectField
              control={form.control}
              name="status"
              label="Status"
              options={OPERATOR_STATUSES}
              description="Only active operators can run buses on the platform."
            />
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
          <CardDescription>How our team reaches the operator.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-5 md:grid-cols-2">
            <TextField
              control={form.control}
              name="contact_phone"
              label="Phone"
              type="tel"
              inputMode="tel"
              placeholder="011 234 5678"
              autoComplete="tel"
            />
            <TextField
              control={form.control}
              name="contact_email"
              label="Email"
              type="email"
              inputMode="email"
              placeholder="ops@company.lk"
              autoComplete="email"
            />
            <div className="md:col-span-2">
              <TextareaField
                control={form.control}
                name="address"
                label="Business address"
                rows={3}
                placeholder="No. 45, Olcott Mawatha, Colombo 11"
              />
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
      <FormActions submitLabel={submitLabel} pending={form.formState.isSubmitting} onCancel={onCancel} />
    </form>
  );
}
