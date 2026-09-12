import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

export function ErrorState({
  error,
  title = "We couldn’t load this",
  onRetry,
  className,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={cn("bg-destructive/5", className)}>
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{getErrorMessage(error)}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
