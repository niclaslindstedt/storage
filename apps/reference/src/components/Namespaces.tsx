// Namespaces this account can use in this app (names decrypted on the
// device), plus creating one and accepting an invite while signed in.

import { useCallback, useEffect, useState } from "react";

import type {
  SelfHostedClient,
  StorageNamespace,
  StorageNamespaceInfo,
} from "@niclaslindstedt/oss-framework/storage";

import { describeError, useLog } from "../log.tsx";

export function Namespaces({
  client,
  current,
  onSelect,
  linked,
}: {
  client: SelfHostedClient;
  current: StorageNamespace | null;
  onSelect: (ns: StorageNamespace | null) => void;
  linked: string | null;
}) {
  const log = useLog();
  const [list, setList] = useState<StorageNamespaceInfo[]>([]);
  const [name, setName] = useState("");
  const [invite, setInvite] = useState(
    linked?.includes("invite") ? linked : "",
  );
  const [notice] = useState(() =>
    sessionStorage.getItem("reference:new-recovery-key"),
  );

  const reload = useCallback(async () => {
    try {
      setList(await client.namespaces());
    } catch (err) {
      log.add("error", describeError(err));
    }
  }, [client, log]);

  useEffect(() => {
    void reload();
    // Joined / removed / deleted elsewhere: the server tells us.
    return client.subscribe((e) => {
      if (e.type === "namespaces") void reload();
    });
  }, [client, reload]);

  useEffect(() => {
    if (current && !list.some((n) => n.id === current.id) && list.length > 0)
      onSelect(null);
  }, [list, current, onSelect]);

  return (
    <section className="card" aria-label="Namespaces">
      <h2>Namespaces</h2>
      {notice && (
        <div className="notice" data-testid="guest-recovery-key">
          Your recovery key (save it): <code>{notice}</code>
          <button
            onClick={() =>
              sessionStorage.removeItem("reference:new-recovery-key")
            }
          >
            Saved
          </button>
        </div>
      )}
      <ul className="list" data-testid="namespace-list">
        {list.map((n) => (
          <li key={n.id}>
            <button
              data-testid="namespace-item"
              data-name={n.meta.name}
              aria-pressed={current?.id === n.id}
              onClick={async () => onSelect(await client.namespace(n.id))}
            >
              {n.meta.name} <small className="muted">{n.role}</small>
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const ns = await client.createNamespace({ name });
            log.add("info", `created namespace ${name}`);
            setName("");
            await reload();
            onSelect(ns);
          } catch (err) {
            log.add("error", describeError(err));
          }
        }}
      >
        <input
          data-testid="namespace-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New namespace name"
        />
        <button data-testid="namespace-create" disabled={!name.trim()}>
          Create
        </button>
      </form>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const { namespace } = await client.acceptInvite(invite);
            log.add("info", `joined ${namespace.meta.name}`);
            setInvite("");
            await reload();
            onSelect(namespace);
          } catch (err) {
            log.add("error", describeError(err));
          }
        }}
      >
        <input
          data-testid="invite-accept-input"
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
          placeholder="Paste an invite"
        />
        <button data-testid="invite-accept" disabled={!invite.trim()}>
          Join
        </button>
      </form>
    </section>
  );
}
