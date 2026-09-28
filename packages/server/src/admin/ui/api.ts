// The console's HTTP client: JSON in and out, downloads and the live log
// stream, over a pluggable transport. The console itself uses the session
// cookie (with the CSRF header on every write and a redirect to the sign-in
// page when the session ends); the remote app installs a transport that
// signs in as an admin device and reaches the same API at /v1/console
// (SPEC §11.2). Pages only ever name `/api/…` paths.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type EventHandlers = {
  open(): void;
  error(): void;
  event(name: string, data: string): void;
};

export type ConsoleTransport = {
  /** True when the console is reached remotely by an admin device. */
  readonly remote: boolean;
  /** Send a request to a console API path (`/api/…`). */
  fetch(
    method: string,
    path: string,
    body: string | undefined,
    headers: Record<string, string>,
  ): Promise<Response>;
  /** The session is gone: go and sign in again. */
  signedOut(): void;
  /** Save what a GET endpoint returns as a file. */
  download(path: string): Promise<void>;
  /** Follow a Server-Sent Events endpoint; returns a function that stops. */
  events(path: string, on: EventHandlers): () => void;
};

/** The local console: same origin, session cookie, CSRF header. */
export const cookieTransport: ConsoleTransport = {
  remote: false,
  fetch(method, path, body, headers) {
    if (method !== "GET") headers["X-Storage-Admin"] = "1";
    return fetch(path, { method, headers, body, credentials: "same-origin" });
  },
  signedOut() {
    location.href = "/login";
  },
  async download(path) {
    const a = document.createElement("a");
    a.href = path;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
  events(path, on) {
    const source = new EventSource(path);
    source.addEventListener("open", () => on.open());
    source.addEventListener("error", () => on.error());
    source.addEventListener("log", (ev) =>
      on.event("log", (ev as MessageEvent<string>).data),
    );
    return () => source.close();
  },
};

let transport: ConsoleTransport = cookieTransport;

/** Point every page at another transport (the remote app does this once). */
export function useTransport(t: ConsoleTransport): void {
  transport = t;
}

/** Whether the console runs remotely on an admin device. */
export function isRemote(): boolean {
  return transport.remote;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await transport.fetch(
    method,
    path,
    body === undefined ? undefined : JSON.stringify(body),
    headers,
  );
  if (res.status === 401) {
    transport.signedOut();
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

/** Save what a GET endpoint returns as a file. */
export function download(path: string): Promise<void> {
  return transport.download(path);
}

/** Follow a Server-Sent Events endpoint. */
export function openEvents(path: string, on: EventHandlers): () => void {
  return transport.events(path, on);
}
