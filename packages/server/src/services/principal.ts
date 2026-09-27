// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Who is making a request: the authenticated device and its account.

export type AccountRole = "admin" | "member" | "guest";

export type Principal = {
  accountId: string;
  accountName: string;
  deviceId: string;
  role: AccountRole;
};

/** Request metadata recorded in the audit log and used for rate limits. */
export type RequestMeta = { ip: string | null; origin: string | null };

export const NAME_PATTERN = /^[^\u0000-\u001f\u007f]{1,64}$/;
export const PLATFORM_PATTERN = /^[a-z0-9-]{1,32}$/;
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
