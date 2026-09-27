// The reference app: every capability of the self-hosted backend on one
// page, with stable `data-testid`s so Playwright can drive it as several
// devices and people at once.

import { useCallback, useEffect, useState } from "react";

import type {
  SelfHostedClient,
  SelfHostedClientState,
  StorageNamespace,
} from "@niclaslindstedt/oss-framework/storage";

import { Connect } from "./components/Connect.tsx";
import { Devices } from "./components/Devices.tsx";
import { Keys } from "./components/Keys.tsx";
import { Namespaces } from "./components/Namespaces.tsx";
import { Notes } from "./components/Notes.tsx";
import { Sharing } from "./components/Sharing.tsx";
import { Todos } from "./components/Todos.tsx";
import { describeError, LogPanel, LogProvider, useLog } from "./log.tsx";
import { createClient, profile, takeLinkedPayload } from "./session.ts";

export function App() {
  return (
    <LogProvider>
      <Shell />
    </LogProvider>
  );
}

function Shell() {
  const log = useLog();
  const [client] = useState<SelfHostedClient>(() => createClient());
  const [state, setState] = useState<SelfHostedClientState | "loading">(
    "loading",
  );
  const [linked] = useState(() => takeLinkedPayload());
  const [ns, setNs] = useState<StorageNamespace | null>(null);

  useEffect(() => {
    client
      .restore()
      .then((s) => {
        setState(s);
        log.add("info", `restored: ${s}`);
      })
      .catch((err) => {
        log.add("error", describeError(err));
        setState("signed-out");
      });
  }, [client, log]);

  const refresh = useCallback(() => setState(client.state), [client]);

  return (
    <main>
      <header className="top">
        <h1>Storage reference app</h1>
        <dl className="facts">
          <dt>Profile</dt>
          <dd data-testid="profile">{profile()}</dd>
          <dt>State</dt>
          <dd data-testid="state">{state}</dd>
          {client.session && (
            <>
              <dt>Server</dt>
              <dd data-testid="server">{client.session.serverUrl}</dd>
              <dt>Device</dt>
              <dd data-testid="device-id">{client.session.deviceId}</dd>
            </>
          )}
        </dl>
        {state !== "signed-out" && state !== "loading" && (
          <button
            data-testid="sign-out"
            onClick={async () => {
              await client.signOut({ forget: true });
              setNs(null);
              refresh();
              log.add("info", "signed out");
            }}
          >
            Sign out and forget this device
          </button>
        )}
      </header>

      {state === "loading" && <p>Loading…</p>}
      {state === "signed-out" && (
        <Connect
          client={client}
          linked={linked}
          onDone={(n) => {
            if (n) setNs(n);
            refresh();
          }}
        />
      )}
      {state === "needs-keys" && <Keys client={client} onReady={refresh} />}
      {state === "ready" && (
        <div className="grid">
          <div className="col">
            <Namespaces
              client={client}
              current={ns}
              onSelect={setNs}
              linked={linked}
            />
            {ns && (
              <Sharing client={client} ns={ns} onGone={() => setNs(null)} />
            )}
            <Devices client={client} />
          </div>
          <div className="col">
            {ns ? (
              <>
                <Todos key={`todos-${ns.id}`} ns={ns} />
                <Notes key={`notes-${ns.id}`} ns={ns} />
              </>
            ) : (
              <p className="card muted" data-testid="no-namespace">
                Create or pick a namespace.
              </p>
            )}
          </div>
        </div>
      )}
      <LogPanel />
    </main>
  );
}
