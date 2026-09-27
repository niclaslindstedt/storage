// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// In-process pub/sub behind `/v1/events` (SSE) and long-polling
// `/changes?wait=`. Events carry no content — only "namespace N is now at seq
// S" — so a device learns *that* something changed and pulls the change
// feed with its own credentials.

export type HubEvent =
  | { type: "ns"; ns: string; seq: number }
  | { type: "namespaces" }
  | { type: "device"; deviceId: string; revoked: boolean };

type Subscriber = {
  accountId: string;
  deviceId: string;
  send: (event: HubEvent) => void;
  close: () => void;
};

type Waiter = { ns: string; after: number; wake: () => void };

export class EventHub {
  private readonly subscribers = new Set<Subscriber>();
  private readonly waiters = new Set<Waiter>();

  subscribe(
    accountId: string,
    deviceId: string,
    send: (event: HubEvent) => void,
    close: () => void = () => {},
  ): () => void {
    const sub: Subscriber = { accountId, deviceId, send, close };
    this.subscribers.add(sub);
    return () => {
      this.subscribers.delete(sub);
    };
  }

  /** A namespace moved to `seq`; tell its members' devices and wake pollers. */
  publishNs(
    ns: string,
    seq: number,
    memberAccountIds: readonly string[],
  ): void {
    const members = new Set(memberAccountIds);
    for (const sub of this.subscribers) {
      if (members.has(sub.accountId)) sub.send({ type: "ns", ns, seq });
    }
    for (const w of [...this.waiters]) {
      if (w.ns === ns && seq > w.after) {
        this.waiters.delete(w);
        w.wake();
      }
    }
  }

  /** An account's namespace list changed (joined, removed, deleted). */
  publishNamespaces(accountIds: readonly string[]): void {
    const set = new Set(accountIds);
    for (const sub of this.subscribers) {
      if (set.has(sub.accountId)) sub.send({ type: "namespaces" });
    }
  }

  /** Tell a revoked device's streams, then close them. */
  revokeDevice(deviceId: string): void {
    for (const sub of [...this.subscribers]) {
      if (sub.deviceId !== deviceId) continue;
      sub.send({ type: "device", deviceId, revoked: true });
      this.subscribers.delete(sub);
      sub.close();
    }
  }

  /** Resolve when `ns` passes `after`, or after `timeoutMs` (false). */
  waitForNs(
    ns: string,
    after: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter: Waiter = {
        ns,
        after,
        wake: () => {
          clearTimeout(timer);
          resolve(true);
        },
      };
      const finish = () => {
        this.waiters.delete(waiter);
        clearTimeout(timer);
        resolve(false);
      };
      timer = setTimeout(finish, timeoutMs);
      signal?.addEventListener("abort", finish, { once: true });
      this.waiters.add(waiter);
    });
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  closeAll(): void {
    for (const sub of [...this.subscribers]) {
      this.subscribers.delete(sub);
      sub.close();
    }
    for (const w of [...this.waiters]) {
      this.waiters.delete(w);
      w.wake();
    }
  }
}
