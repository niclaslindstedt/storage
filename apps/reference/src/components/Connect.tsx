// Signed out: pair with a pairing code, or join a namespace with an invite.

import { useState } from "react";

import {
  parseStoragePayload,
  type SelfHostedClient,
  type StorageNamespace,
} from "@niclaslindstedt/oss-framework/storage";

import { describeError, useLog } from "../log.tsx";
import { profile } from "../session.ts";

export function Connect({
  client,
  linked,
  onDone,
}: {
  client: SelfHostedClient;
  linked: string | null;
  onDone: (ns?: StorageNamespace) => void;
}) {
  const log = useLog();
  const [code, setCode] = useState(linked ?? "");
  const [deviceName, setDeviceName] = useState(`${profile()} browser`);
  const [accountName, setAccountName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let kind: "pair" | "invite" | null = null;
  try {
    kind = code.trim() ? parseStoragePayload(code).kind : null;
  } catch {
    kind = null;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (kind === "invite") {
        const { namespace, recoveryKey } = await client.acceptInvite(code, {
          accountName,
          device: { name: deviceName },
        });
        log.add("info", `joined ${namespace.meta.name} as a guest`);
        if (recoveryKey)
          sessionStorage.setItem("reference:new-recovery-key", recoveryKey);
        onDone(namespace);
      } else {
        const state = await client.pair(code, { name: deviceName });
        log.add("info", `paired: ${state}`);
        onDone();
      }
    } catch (err) {
      setError(describeError(err));
      log.add("error", describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Connect">
      <h2>Connect to your server</h2>
      <p className="muted">
        Paste the pairing code from your server (or another device), or an
        invite someone sent you.
      </p>
      <label>
        Code
        <textarea
          data-testid="pair-input"
          rows={3}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="oss-storage://pair?…"
        />
      </label>
      <label>
        This device's name
        <input
          data-testid="device-name"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
        />
      </label>
      {kind === "invite" && (
        <label>
          Your name (a guest account is created for you)
          <input
            data-testid="guest-name"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
          />
        </label>
      )}
      <button
        data-testid="pair-submit"
        disabled={busy || kind === null || (kind === "invite" && !accountName)}
        onClick={submit}
      >
        {kind === "invite" ? "Join" : "Pair this device"}
      </button>
      {code.trim() && kind === null && (
        <p className="error">That is not a pairing code or invite.</p>
      )}
      {error && (
        <p className="error" data-testid="pair-error">
          {error}
        </p>
      )}
    </section>
  );
}
