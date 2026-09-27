// The console's HTTP client: JSON in and out, the CSRF header on every
// write, and a redirect to the sign-in page when the session has ended.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-Storage-Admin"] = "1";
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 401) {
    location.href = "/login";
    throw new HttpError(401, "signed out");
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${res.status}`;
    throw new HttpError(res.status, message);
  }
  return data as T;
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body?: unknown) =>
  request<T>("POST", path, body ?? {});
export const patch = <T>(path: string, body: unknown) =>
  request<T>("PATCH", path, body);
export const del = <T>(path: string, body?: unknown) =>
  request<T>("DELETE", path, body);

/** Start a download of a GET endpoint (the session cookie authenticates). */
export function download(path: string): void {
  const a = document.createElement("a");
  a.href = path;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
