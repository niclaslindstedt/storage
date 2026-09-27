// Paired but without the account key: create it (first device), recover it,
// or wait for another device to approve this one.

import { useEffect, useState } from "react";

import type { SelfHostedClient } from "@niclaslindstedt/oss-framework/storage";

import { describeError, useLog } from "../log.tsx";

export function Keys({
  client,
  onReady,
}: {
  client: SelfHostedClient;
  onReady: () => void;
}) {
  const log = useLog();
  const [hasKeys, setHasKeys] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void client.accountHasKeys().then(setHasKeys);
    void client.safetyCode().then(setCode);
  }, [client]);

  // Wait for approval by another device.
  useEffect(() => {
    if (!hasKeys) return;
    const ac = new AbortController();
    void client
      .waitForApproval({ signal: ac.signal, intervalMs: 1000 })
      .then((s) => {
        if (s === "ready") {
          log.add("info", "approved by another device");
          onReady();
        }
      });
    return () => ac.abort();
  }, [client, hasKeys, log, onReady]);

  if (recoveryKey) {
    return (
      <section className="card" aria-label="Recovery key">
        <h2>Your recovery key</h2>
        <p>
          Write this down. It is the only way back if you lose every device —
          the server never sees it.
        </p>
        <code className="recovery" data-testid="recovery-key">
          {recoveryKey}
        </code>
        <button data-testid="recovery-saved" onClick={onReady}>
          I have saved it
        </button>
      </section>
    );
  }

  if (hasKeys === null) return <p>Checking your account…</p>;

  if (!hasKeys) {
    return (
      <section className="card" aria-label="Create account key">
        <h2>Set up encryption</h2>
        <p>
          This is the first device on your account. Create your account key — it
          never leaves your devices.
        </p>
        <button
          data-testid="create-keys"
          onClick={async () => {
            try {
              setRecoveryKey(await client.createAccountKeys());
              log.add("info", "account key created");
            } catch (err) {
              setError(describeError(err));
            }
          }}
        >
          Create account key
        </button>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="card" aria-label="Approve this device">
      <h2>Approve this device</h2>
      <p>
        On a device that already works, open <b>Devices</b> and approve the one
        showing this code:
      </p>
      <code className="safety" data-testid="safety-code">
        {code}
      </code>
      <h3>Or use your recovery key</h3>
      <input
        data-testid="recovery-input"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="XXXX-XXXX-…"
      />
      <button
        data-testid="recover-submit"
        onClick={async () => {
          try {
            await client.recover(typed);
            log.add("info", "recovered with the recovery key");
            onReady();
          } catch (err) {
            setError(describeError(err));
            log.add("error", describeError(err));
          }
        }}
      >
        Recover
      </button>
      {error && (
        <p className="error" data-testid="recover-error">
          {error}
        </p>
      )}
    </section>
  );
}
