// Storage Remote in a phone-sized browser against a real server: pair as an
// admin device, set up keys, run the server from the Server tab, and keep
// files in an encrypted shared folder.

import { expect, type Page, test as base } from "@playwright/test";

import {
  connectTestServer,
  type TestServer,
} from "../../../packages/testkit/src/index.ts";
import { SERVER_URL, TEST_SECRET } from "../playwright.config.ts";

const test = base.extend<{ server: TestServer }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take no dependencies this way
  server: async ({}, use) => {
    const server = connectTestServer(SERVER_URL, TEST_SECRET);
    await server.reset();
    await use(server);
  },
});

/** Pair the app with a code and create the account's key. */
async function pairAndCreateKeys(page: Page, code: string) {
  await page.goto("/");
  await page.getByTestId("pair-payload").fill(code);
  await page.getByTestId("device-name").fill("Test phone");
  await page.getByTestId("pair-submit").click();
  await page.getByTestId("create-keys").click();
  await expect(page.getByTestId("recovery-key")).toHaveText(/^[0-9A-Z-]{20,}$/);
  await page.getByTestId("rk-kept").check();
  await page.getByTestId("rk-done").click();
  await expect(page.getByTestId("tab-files")).toBeVisible();
}

test("an admin device runs the server and keeps encrypted files", async ({
  page,
  server,
}) => {
  const owner = await server.createAccount("owner", { role: "admin" });
  const admin = await server.pairingFor(owner.account.id, { console: true });
  await pairAndCreateKeys(page, admin.pairingUri);

  // Files: a shared folder, an upload, a subfolder.
  await page.getByTestId("new-drive").click();
  await page.getByTestId("folder-name").fill("Documents");
  await page.getByTestId("folder-create").click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await page.getByTestId("upload-input").setInputFiles({
    name: "passport.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("scan of my passport"),
  });
  await expect(page.getByTestId("file-passport.txt")).toBeVisible();
  // Uploading it again replaces it; the version it replaced is kept.
  await page.getByTestId("upload-input").setInputFiles({
    name: "passport.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("scan of my new passport"),
  });
  await page.getByTestId("replace").click();
  await expect(page.getByTestId("toast").last()).toContainText("1 replaced");
  await page
    .getByTestId("file-passport.txt")
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByTestId("preview-text")).toHaveText(
    "scan of my new passport",
  );
  await page
    .getByTestId("preview-dialog")
    .getByRole("button", { name: "Versions" })
    .click();
  const versions = page.getByTestId("versions-dialog");
  await expect(versions.getByTestId("diff-del")).toContainText(
    "scan of my passport",
  );
  await expect(versions.getByTestId("diff-add")).toContainText(
    "scan of my new passport",
  );
  await versions.getByTestId("restore-1").click();
  await expect(page.getByTestId("toast").last()).toContainText("Restored");
  await page.getByTestId("new-subfolder").click();
  await page.getByTestId("name-input").fill("Taxes");
  await page.getByTestId("name-submit").click();
  await expect(page.getByTestId("folder-Taxes")).toBeVisible();
  await page.getByTestId("folder-Taxes").getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Taxes" })).toBeVisible();
  await expect(page.getByText("This folder is empty.")).toBeVisible();

  // The server never saw the name: the console lists the namespace by id.
  await page.getByTestId("tab-server").click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Namespaces", exact: true })
    .click();
  const namespaces = page.getByRole("main");
  await expect(namespaces).toContainText("drive");
  await expect(namespaces).not.toContainText("Documents");

  // Add a user from the phone and show their pairing QR.
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Accounts", exact: true })
    .click();
  await page.getByTestId("new-account").click();
  const form = page.getByTestId("account-dialog");
  await form.getByLabel("Name").fill("grandma");
  await form.getByTestId("submit").click();
  await expect(
    page.getByTestId("pairing-dialog").getByTestId("pairing-qr"),
  ).toBeVisible();
  await page
    .getByTestId("pairing-dialog")
    .getByRole("button", { name: "Close" })
    .click();
  await expect(page.getByTestId("account-grandma")).toBeVisible();
  // An admin device cannot mint another admin device.
  await expect(page.getByTestId("pair-admin-app")).toHaveCount(0);

  // The audit log names this phone, not "admin-console".
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Audit log", exact: true })
    .click();
  await expect(page.getByTestId("audit-table")).toContainText("dev_");

  // This phone.
  await page.getByTestId("tab-phone").click();
  await expect(page.getByText("admin device", { exact: true })).toBeVisible();
});

test("an ordinary device gets the files but not the server", async ({
  page,
  server,
}) => {
  const owner = await server.createAccount("owner", { role: "admin" });
  await pairAndCreateKeys(page, owner.pairingUri);
  await page.getByTestId("tab-server").click();
  await expect(
    page.getByRole("heading", { name: "This phone is not an admin device" }),
  ).toBeVisible();
  await page.getByTestId("tab-files").click();
  await expect(page.getByTestId("new-drive")).toBeVisible();
});
