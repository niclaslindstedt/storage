// This account's devices: add one by QR, approve one after comparing safety
// codes, revoke one.

import { useCallback, useEffect, useState } from "react";

import type {
  SelfHostedClient,
  SelfHostedDevice,
} from "@niclaslindstedt/oss-framework/storage";
import { QrCode } from "@niclaslindstedt/oss-framework/qr";

import { describeError, useLog } from "../log.tsx";
import { appUrl } from "../session.ts";

export function Devices({ client }: { client: SelfHostedClient }) {
  const log = useLog();
  const [devices, setDevices] = useState<SelfHostedDevice[]>([]);
  const [pending, setPending] = useState<
    (SelfHostedDevice & { safetyCode: string })[]
  >([]);
  const [payload, setPayload] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDevices(await client.devices());
      setPending(await client.pendingDevices());
    } catch (err) {
      log.add("error", describeError(err));
    }
  }, [client, log]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <section className="card" aria-label="Devices">
      <h2>Devices</h2>
      <ul className="list" data-testid="device-list">
        {devices.map((d) => (
          <li
            key={d.id}
            data-testid="device-item"
            data-revoked={d.revokedAt ? "yes" : "no"}
          >
            {d.name}{" "}
            <small className="muted">
              {d.platform}
              {d.revokedAt ? " · revoked" : d.hasAccountKey ? "" : " · waiting"}
            </small>
            {!d.revokedAt && d.id !== client.session?.deviceId && (
              <button
                data-testid="device-revoke"
                onClick={async () => {
                  await client.revokeDevice(d.id);
                  log.add("info", `revoked ${d.name}`);
                  await reload();
                }}
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      <button data-testid="refresh-devices" onClick={reload}>
        Refresh
      </button>
      {pending.length > 0 && (
        <div data-testid="pending-devices">
          <h3>Waiting for approval</h3>
          {pending.map((d) => (
            <div key={d.id} className="pending">
              <b>{d.name}</b> shows{" "}
              <code data-testid="pending-code">{d.safetyCode}</code>
              <button
                data-testid="approve-device"
                onClick={async () => {
                  await client.approveDevice(d.id);
                  log.add("info", `approved ${d.name}`);
                  await reload();
                }}
              >
                Codes match — approve
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        data-testid="add-device"
        onClick={async () => {
          try {
            const r = await client.addDevicePayload({
              ttlSeconds: 600,
              appUrl: appUrl(),
            });
            setPayload(r.payload);
            log.add("info", "showing an add-device code");
          } catch (err) {
            log.add("error", describeError(err));
          }
        }}
      >
        Add a device
      </button>
      {payload && (
        <div className="qr">
          <QrCode value={payload} size={200} label="Scan to add a device" />
          <textarea
            readOnly
            data-testid="add-device-payload"
            value={payload}
            rows={3}
          />
        </div>
      )}
    </section>
  );
}
