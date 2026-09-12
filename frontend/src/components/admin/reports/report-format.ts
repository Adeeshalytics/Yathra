import { formatCalendarDate, formatCurrency, formatDateTime } from "@/lib/format";

/** Columns the server sends as decimal strings; everything else prints as it arrives. */
const MONEY_KEYS = new Set([
  "amount",
  "average_fare",
  "average_payment",
  "average_value",
  "average_booking_value",
  "booking_value",
  "captured",
  "gross",
  "gross_revenue",
  "net",
  "net_revenue",
  "paid_amount",
  "refund_amount",
  "refunded",
  "refunded_amount",
  "refunds",
  "refunds_completed",
  "refunds_requested",
  "total_amount",
  "value",
]);

const DATE_ONLY_KEYS = new Set(["day", "date"]);
const PERCENT_KEYS = new Set(["occupancy", "cancellation_rate"]);

function isTimestamp(key: string): boolean {
  return (
    key.endsWith("_at") ||
    key === "departure" ||
    key === "departure_datetime" ||
    key === "printed_at"
  );
}

/** Turns one report cell into something readable, based on what its column is called. */
export function formatReportValue(
  key: string,
  value: string | number | boolean | null,
  currency = "LKR",
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value);
  if (MONEY_KEYS.has(key)) return formatCurrency(text, currency);
  if (PERCENT_KEYS.has(key)) return `${text}%`;
  if (DATE_ONLY_KEYS.has(key)) return formatCalendarDate(text);
  if (isTimestamp(key)) return formatDateTime(text);
  return text;
}

/** "average_booking_value" → "Average booking value" for summary cards. */
export function humanize(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface SummaryEntry {
  key: string;
  label: string;
  value: string;
}

/** The server's totals, flattened into cards. Lists (e.g. per-gateway takings) are skipped. */
export function summaryEntries(
  summary: Record<string, unknown>,
  currency = "LKR",
): SummaryEntry[] {
  return Object.entries(summary)
    .filter(
      ([, value]) =>
        value !== null && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
    )
    .map(([key, value]) => ({
      key,
      label: humanize(key),
      value: formatReportValue(key, value as string | number | boolean, currency),
    }));
}
