import type { ApiErrorBody } from "./types";

const NETWORK_MESSAGE = "We couldn’t reach the server. Check your connection and try again.";
const FALLBACK_MESSAGE = "Something went wrong. Please try again.";

/** Every non-2xx API response is surfaced as an ApiError carrying the backend's error envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;
  readonly requestId: string | null;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown> | null;
    requestId?: string | null;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details ?? null;
    this.requestId = options.requestId ?? null;
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    const requestId = response.headers.get("X-Request-ID");
    try {
      const body = (await response.json()) as Partial<ApiErrorBody>;
      if (body.error) {
        return new ApiError({
          status: response.status,
          code: body.error.code,
          message: body.error.message,
          details: body.error.details,
          requestId: body.error.request_id ?? requestId,
        });
      }
    } catch {
      // Non-JSON body (e.g. a proxy error page): fall through to a generic error.
    }
    return new ApiError({
      status: response.status,
      code: "http_error",
      message: FALLBACK_MESSAGE,
      requestId,
    });
  }

  static network(): ApiError {
    return new ApiError({ status: 0, code: "network_error", message: NETWORK_MESSAGE });
  }

  /** `{ field: firstMessage }`, for mapping validation errors onto form inputs. */
  get fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    if (!this.details) return result;
    for (const [field, value] of Object.entries(this.details)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") result[field] = first;
    }
    return result;
  }
}

export function getErrorMessage(error: unknown, fallback = FALLBACK_MESSAGE): string {
  return error instanceof ApiError ? error.message : fallback;
}
