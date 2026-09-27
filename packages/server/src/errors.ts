// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The one error type the API speaks. Services throw `ApiError`s; the HTTP
// layer renders them as `{ error: { code, message, ...details } }` with the
// matching status. Anything else is a 500 whose details never reach the
// client.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new ApiError(400, "invalid_request", message, details);

export const unauthenticated = (message = "authentication required") =>
  new ApiError(401, "unauthenticated", message);

export const forbidden = (message = "not allowed") =>
  new ApiError(403, "forbidden", message);

export const notFound = (message = "not found", details?: Record<string, unknown>) =>
  new ApiError(404, "not_found", message, details);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new ApiError(409, "conflict", message, details);

export const preconditionFailed = (current: Record<string, unknown> | null) =>
  new ApiError(412, "conflict", "revision mismatch", { current });

export const gone = (message: string, details?: Record<string, unknown>) =>
  new ApiError(410, "cursor_expired", message, details);

export const tooLarge = (message: string) =>
  new ApiError(413, "too_large", message);

export const rateLimited = (retryAfterMs: number) =>
  new ApiError(
    429,
    "rate_limited",
    "too many requests",
    { retryAfterMs },
    { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
  );

export const quotaExceeded = (usedBytes: number, quotaBytes: number) =>
  new ApiError(507, "quota_exceeded", "storage quota exceeded", {
    usedBytes,
    quotaBytes,
  });
