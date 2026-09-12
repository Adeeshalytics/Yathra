import type { PriceQuote } from "@/lib/api/trip-types";
import { formatCurrency, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** The server's price, line by line. Fees, discounts and tax appear only when they apply. */
export function PriceBreakdown({ quote, className }: { quote: PriceQuote; className?: string }) {
  const money = (value: string) => formatCurrency(value, quote.currency);
  const applies = (value: string) => Number(value) > 0;
  return (
    <dl className={cn("space-y-1.5 text-sm", className)}>
      <Line label={`${money(quote.unit_price)} × ${pluralize(quote.seats, "seat")}`} value={money(quote.subtotal)} />
      {applies(quote.service_fee) && <Line label="Service fee" value={money(quote.service_fee)} />}
      {applies(quote.discount) && <Line label="Discount" value={`− ${money(quote.discount)}`} />}
      {applies(quote.tax) && <Line label="Taxes" value={money(quote.tax)} />}
      <div className="flex justify-between gap-3 border-t pt-2 font-heading text-lg font-bold">
        <dt>Total</dt>
        <dd className="tabular-nums">{money(quote.total)}</dd>
      </div>
    </dl>
  );
}
