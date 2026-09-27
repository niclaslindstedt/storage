// Share THIS namespace: invite by QR / link, see members, remove one (which
// rotates the key), leave, delete.

import { useCallback, useEffect, useState } from "react";

import type {
  NamespaceMember,
  SelfHostedClient,
  StorageNamespace,
} from "@niclaslindstedt/oss-framework/storage";
import { QrCode } from "@niclaslindstedt/oss-framework/qr";

import { describeError, useLog } from "../log.tsx";
import { appUrl } from "../session.ts";

export function Sharing({
  client,
  ns,
  onGone,
}: {
  client: SelfHostedClient;
  ns: StorageNamespace;
  onGone: () => void;
}) {
  const log = useLog();
  const [members, setMembers] = useState<NamespaceMember[]>([]);
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [payload, setPayload] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setMembers(await ns.members());
    } catch (err) {
      log.add("error", describeError(err));
    }
  }, [ns, log]);

  useEffect(() => {
    void reload();
    // Someone joined, left or was removed: the namespace moved.
    return ns.watch(() => void reload());
  }, [ns, reload]);

  const me = client.session?.accountId;
  return (
    <section className="card" aria-label="Sharing">
      <h2>
        Sharing{" "}
        <small className="muted" data-testid="my-role">
          {ns.role}
        </small>{" "}
        <small className="muted" data-testid="epoch">
          epoch {ns.epoch}
        </small>
      </h2>
      <ul className="list" data-testid="member-list">
        {members.map((m) => (
          <li key={m.accountId} data-testid="member-item" data-name={m.name}>
            {m.name} <small className="muted">{m.role}</small>
            {ns.role === "owner" && m.accountId !== me && (
              <button
                data-testid="member-remove"
                onClick={async () => {
                  try {
                    await ns.removeMember(m.accountId);
                    log.add(
                      "info",
                      `removed ${m.name}; key rotated to epoch ${ns.epoch}`,
                    );
                    await reload();
                  } catch (err) {
                    log.add("error", describeError(err));
                  }
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {ns.role === "owner" ? (
        <>
          <select
            data-testid="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
          >
            <option value="viewer">Can view</option>
            <option value="editor">Can edit</option>
          </select>
          <button
            data-testid="invite-create"
            onClick={async () => {
              try {
                const r = await ns.invite({ role, appUrl: appUrl() });
                setPayload(r.payload);
                log.add("info", `invite created (${role})`);
              } catch (err) {
                log.add("error", describeError(err));
              }
            }}
          >
            Invite someone
          </button>
          {payload && (
            <div className="qr">
              <QrCode
                value={payload}
                size={200}
                label="Scan to join this namespace"
              />
              <textarea
                readOnly
                data-testid="invite-payload"
                value={payload}
                rows={3}
              />
            </div>
          )}
          <button
            className="danger"
            data-testid="namespace-delete"
            onClick={async () => {
              await ns.delete();
              log.add("info", `deleted ${ns.meta.name}`);
              onGone();
            }}
          >
            Delete namespace
          </button>
        </>
      ) : (
        <button
          data-testid="namespace-leave"
          onClick={async () => {
            await ns.leave();
            log.add("info", `left ${ns.meta.name}`);
            onGone();
          }}
        >
          Leave
        </button>
      )}
    </section>
  );
}
