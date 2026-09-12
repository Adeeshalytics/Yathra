import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError, getErrorMessage } from "@/lib/api/errors";

/**
 * Map an API validation error onto form fields. Returns the message to show in a
 * form-level banner, or `null` when every problem was attached to a field.
 */
export function applyApiErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!(error instanceof ApiError)) return getErrorMessage(error);

  const fieldErrors = error.fieldErrors;
  let mapped = false;
  for (const field of fields) {
    const message = fieldErrors[field];
    if (message) {
      setError(field, { type: "server", message }, { shouldFocus: !mapped });
      mapped = true;
    }
  }
  if (fieldErrors.non_field_errors) return fieldErrors.non_field_errors;
  return mapped ? null : error.message;
}

/**
 * Every message the API returned for one field, flattened. Handles plain lists
 * (`["msg", …]`) and per-item lists of objects (`[{}, {"row": ["msg"]}]`).
 */
export function fieldErrorList(error: unknown, field: string): string[] {
  if (!(error instanceof ApiError) || !error.details) return [];
  const value = error.details[field];
  if (!Array.isArray(value)) return typeof value === "string" ? [value] : [];
  return value.flatMap((item, index) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") {
      return Object.entries(item as Record<string, unknown>).flatMap(([key, messages]) =>
        (Array.isArray(messages) ? messages : [messages])
          .filter((message): message is string => typeof message === "string")
          .map((message) => `Item ${index + 1} – ${key.replace(/_/g, " ")}: ${message}`),
      );
    }
    return [];
  });
}
