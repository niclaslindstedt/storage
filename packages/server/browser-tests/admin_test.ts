// The admin console in a real browser: sign-in, every page, and the flows an
// operator runs — create an account and show its pairing QR, pair and revoke
// a device, disable and delete an account, tail logs, verify the audit
// chain, run checks.

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { API_URL, DATA_DIR } from "../playwright.config.ts";

const token = () => readFileSync(join(DATA_DIR, "admin.token"), "utf8").trim();

async function signIn(page: Page) {
  await page.goto(`/login?token=${token()}`);
  await expect(page.getByTestId("health-pill")).toBeVisible();
  expect(page.url()).not.toContain("token=");
}

/** Open a section from the sidebar. */
const go = (page: Page, section: string) =>
  page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: section, exact: true })
    .click();

const b64u = (b: ArrayBuffer) => Buffer.from(b).toString("base64url");

/** Redeem a pairing payload like a device would (keys made here). */
async function pairDevice(payload: string, name: string) {
  const code = new URL(
    payload.replace("oss-storage://", "https://x/"),
  ).searchParams.get("c")!;
  const dsk = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const dek = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const res = await fetch(`${API_URL}/v1/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      device: {
        name,
        platform: "android",
        dskPublic: b64u(await webcrypto.subtle.exportKey("raw", dsk.publicKey)),
        dekPublic: b64u(await webcrypto.subtle.exportKey("raw", dek.publicKey)),
      },
    }),
  });
  expect(res.status).toBe(201);
}

test("sign-in: the token unlocks the console, a wrong one does not", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Admin token").fill("x".repeat(43));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That token is not valid.");
  await page.getByLabel("Admin token").fill(token());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByTestId("health")).toBeVisible();

  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("overview reports traffic to the device API", async ({ page }) => {
  for (let i = 0; i < 5; i++) await fetch(`${API_URL}/v1/info`);
  await signIn(page);
  await expect(page.getByTestId("stat-requests")).toContainText(/\d/);
  const value = await page
    .getByTestId("stat-requests")
    .locator(".stat-value")
    .textContent();
  expect(Number(value!.replace(/\D/g, ""))).toBeGreaterThanOrEqual(5);
  await expect(
    page.getByRole("img", { name: /Requests per minute/ }),
  ).toBeVisible();
});

test("accounts: create with a pairing QR, pair a device, revoke it, disable and delete", async ({
  page,
}) => {
  await signIn(page);
  await go(page, "Accounts");
  await page.getByTestId("new-account").click();
  const form = page.getByTestId("account-dialog");
  await form.getByLabel("Name").fill("mum");
  await form.getByTestId("submit").click();

  // The pairing QR appears right away.
  const pairing = page.getByTestId("pairing-dialog");
  await expect(pairing.getByTestId("pairing-qr")).toBeVisible();
  const payload = await pairing.getByTestId("pairing-payload").inputValue();
  expect(payload).toMatch(/^oss-storage:\/\/pair\?v=1&s=/);
  await expect(pairing.getByTestId("pairing-countdown")).toHaveText(
    /^\d+:\d{2}$/,
  );
  await pairing.getByRole("button", { name: "Close" }).click();

  const row = page.getByTestId("account-mum");
  await expect(row).toContainText("member");

  // A device redeems the code; it shows on the Devices page and can be revoked.
  await pairDevice(payload, "Mum's phone");
  await go(page, "Devices");
  const device = page.getByTestId("device-Mum's phone");
  await expect(device).toContainText("pending");
  await device.getByTestId("revoke").click();
  await page.getByTestId("confirm-button").click();
  await expect(device).toContainText("revoked");

  // Edit, disable, delete.
  await go(page, "Accounts");
  await row.getByTestId("edit").click();
  await page
    .getByTestId("account-dialog")
    .getByTestId("role-select")
    .selectOption("guest");
  await page.getByTestId("account-dialog").getByTestId("submit").click();
  await expect(row).toContainText("guest");

  await row.getByTestId("toggle").click();
  await page.getByTestId("confirm-button").click();
  await expect(row).toContainText("disabled");

  await row.getByTestId("delete").click();
  const confirmButton = page.getByTestId("confirm-button");
  await expect(confirmButton).toBeDisabled();
  await page.getByTestId("confirm-input").fill("mum");
  await confirmButton.click();
  await expect(row).toHaveCount(0);

  // Everything above is in the audit log, by the console.
  await go(page, "Audit log");
  const audit = page.getByTestId("audit-table");
  for (const action of [
    "account.create",
    "pairing.create",
    "device.revoke",
    "account.update",
    "account.delete",
  ])
    await expect(audit).toContainText(action);
  await page.getByTestId("audit-verify").click();
  await expect(page.getByTestId("audit-verdict")).toContainText("chain intact");
});

test("admin app: pair a phone as an admin device, then take its access away", async ({
  page,
}) => {
  await signIn(page);
  await go(page, "Accounts");
  await page.getByTestId("new-account").click();
  const form = page.getByTestId("account-dialog");
  await form.getByLabel("Name").fill("owner");
  await form.getByTestId("role-select").selectOption("admin");
  await form.getByTestId("pair-now").uncheck();
  await form.getByTestId("submit").click();

  const row = page.getByTestId("account-owner");
  await row.getByTestId("pair-admin-app").click();
  const pairing = page.getByTestId("pairing-dialog");
  await expect(pairing).toContainText("admin device");
  const payload = await pairing.getByTestId("pairing-payload").inputValue();
  await pairing.getByRole("button", { name: "Close" }).click();

  await pairDevice(payload, "Owner's phone");
  await go(page, "Devices");
  const device = page.getByTestId("device-Owner's phone");
  await expect(device).toContainText("admin device");
  await device.getByTestId("drop-console").click();
  await page.getByTestId("confirm-button").click();
  await expect(device).not.toContainText("admin device");
  await expect(device.getByTestId("drop-console")).toHaveCount(0);
});

test("agent: pair an AI agent limited to reading the drive", async ({
  page,
}) => {
  await signIn(page);
  await go(page, "Accounts");
  await page.getByTestId("new-account").click();
  const form = page.getByTestId("account-dialog");
  await form.getByLabel("Name").fill("researcher");
  await form.getByTestId("pair-now").uncheck();
  await form.getByTestId("submit").click();

  const row = page.getByTestId("account-researcher");
  await row.getByTestId("pair-agent").click();
  const agent = page.getByTestId("agent-dialog");
  await expect(agent.getByTestId("agent-perm-data:read")).toBeChecked();
  await expect(agent.getByTestId("agent-perm-data:write")).not.toBeChecked();
  // A member account: no console permissions on offer.
  await expect(agent.getByTestId("agent-perm-console:read")).toHaveCount(0);
  await agent.getByTestId("agent-apps").fill("drive");
  await agent.getByTestId("agent-submit").click();

  const pairing = page.getByTestId("pairing-dialog");
  await expect(pairing).toContainText("storage-mcp pair");
  const payload = await pairing.getByTestId("pairing-payload").inputValue();
  await pairing.getByRole("button", { name: "Close" }).click();

  await pairDevice(payload, "Research agent");
  await go(page, "Devices");
  const device = page.getByTestId("device-Research agent");
  await expect(device).toContainText("agent");
  await expect(device.getByTestId("agent-scope")).toHaveText(
    "data:read · drive",
  );
});

test("logs: live tail with filter", async ({ page }) => {
  await signIn(page);
  await go(page, "Logs");
  await expect(page.getByTestId("log-status")).toHaveText("live");
  await expect(page.getByTestId("log-list")).toContainText(
    "storage-server — e2e-home",
  );

  // A console action writes a log line; it arrives over the live stream.
  const res = await page.request.post("/api/actions/housekeeping", {
    headers: { "X-Storage-Admin": "1" },
  });
  expect(res.status()).toBe(200);
  await expect(page.getByTestId("log-list")).toContainText(
    "admin console: housekeeping",
  );

  await page.getByTestId("log-search").fill("admin console listening");
  await expect(page.getByTestId("log-list").locator("li")).toHaveCount(1);
  await page.getByTestId("log-search").fill("");
  await page.getByTestId("log-level").selectOption("error");
  await expect(page.getByTestId("log-list")).not.toContainText("housekeeping");
});

test("namespaces, traffic and troubleshoot pages render", async ({ page }) => {
  await signIn(page);
  await go(page, "Namespaces");
  await expect(page.getByTestId("namespaces-table")).toBeVisible();
  await go(page, "Traffic");
  await expect(page.getByTestId("routes-table")).toContainText("/v1/info");

  await go(page, "Troubleshoot");
  await expect(page.getByTestId("check-database")).toContainText("ok");
  await expect(page.getByTestId("check-admin-account")).toBeVisible();
  await page.getByTestId("run-checks").click();
  await expect(page.getByTestId("check-audit-chain")).toContainText("ok");
  await page.getByTestId("housekeeping").click();
  await expect(page.getByTestId("toast").last()).toContainText("Done");
  const download = page.waitForEvent("download");
  await page.getByTestId("diagnostics").click();
  expect((await download).suggestedFilename()).toMatch(
    /^storage-diagnostics-.*\.json$/,
  );
});

test("settings: change how long file versions are kept, then go back", async ({
  page,
}) => {
  await signIn(page);
  await go(page, "Settings");
  const days = page.getByTestId("setting-historyDays");
  await expect(days).toHaveValue("30");
  await days.fill("90");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("toast").last()).toContainText("saved");
  await expect(page.getByTestId("setting-historyDays")).toHaveValue("90");
  const info = (await (await fetch(`${API_URL}/v1/info`)).json()) as {
    retention: { historyDays: number };
  };
  expect(info.retention.historyDays).toBe(90);
  await page.getByTestId("reset-historyDays").click();
  await expect(page.getByTestId("setting-historyDays")).toHaveValue("30");
  await expect(page.getByTestId("reset-historyDays")).toHaveCount(0);
});

test("the console refuses to be driven from another site", async ({
  page,
  request,
}) => {
  await signIn(page);
  // A cross-origin form post cannot carry the CSRF header.
  const res = await request.post("/api/accounts", {
    data: { name: "evil", role: "admin" },
    headers: { Origin: "https://evil.example" },
  });
  expect([401, 403]).toContain(res.status());
});
