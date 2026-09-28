// The web drive in a desktop browser against a real server: sign in with a
// code, create the account key, keep files in a shared folder, replace one
// and compare the versions, and watch a second browser's changes sync in.

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

async function signIn(page: Page, code: string, name: string) {
  await page.goto("/");
  await page.getByTestId("pair-payload").fill(code);
  await page.getByTestId("device-name").fill(name);
  await page.getByTestId("pair-submit").click();
}

const text = (name: string, body: string) => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from(body),
});

test("sign in, keep files, replace one and compare its versions", async ({
  page,
  server,
}) => {
  const me = await server.createAccount("niclas");
  await signIn(page, me.pairingUri, "Laptop");
  await page.getByTestId("create-keys").click();
  await expect(page.getByTestId("recovery-key")).toHaveText(/^[0-9A-Z-]{20,}$/);
  await page.getByTestId("rk-kept").check();
  await page.getByTestId("rk-done").click();
  await expect(page.getByTestId("sync-status")).toHaveAttribute(
    "data-state",
    "live",
  );

  // A shared folder, listed in the sidebar.
  await page.getByTestId("new-drive").click();
  await page.getByTestId("folder-name").fill("Documents");
  await page.getByTestId("folder-create").click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await expect(page.getByTestId("sidebar-folders")).toContainText("Documents");

  // Upload, then open it: decrypted and shown here.
  await page
    .getByTestId("upload-input")
    .setInputFiles(text("plan.md", "# Plan\n\n- buy milk\n- call mum\n"));
  await expect(page.getByTestId("file-plan.md")).toBeVisible();
  await page.getByTestId("file-plan.md").getByRole("button").first().click();
  await expect(page.getByTestId("preview-text")).toContainText("buy milk");
  await page.keyboard.press("Escape");

  // Upload a new plan.md: replace it, and the old one is kept as a version.
  await page
    .getByTestId("upload-input")
    .setInputFiles(
      text("plan.md", "# Plan\n\n- buy oat milk\n- call mum\n- book dentist\n"),
    );
  await expect(page.getByTestId("collision-dialog")).toContainText(
    "plan.md already exists",
  );
  await page.getByTestId("replace").click();
  await expect(page.getByTestId("toast").last()).toContainText("1 replaced");
  await page.getByTestId("file-plan.md").getByRole("button").first().click();
  await page
    .getByTestId("preview-dialog")
    .getByRole("button", { name: "Versions" })
    .click();

  const versions = page.getByTestId("versions-dialog");
  await expect(versions).toContainText("kept for 30 days");
  await expect(versions.getByTestId("versions").locator("li")).toHaveCount(2);
  // What changed, line by line, decrypted and compared in this browser.
  await expect(versions.getByTestId("diff-del")).toHaveText(/- buy milk/);
  const added = versions.getByTestId("diff-add");
  await expect(added).toHaveCount(2);
  await expect(added.first()).toContainText("buy oat milk");
  await expect(added.last()).toContainText("book dentist");

  // Keep both instead: a second file beside it.
  await page.keyboard.press("Escape");
  await page
    .getByTestId("upload-input")
    .setInputFiles(text("plan.md", "another plan"));
  await page.getByTestId("keep-both").click();
  await expect(page.getByTestId("file-plan (2).md")).toBeVisible();

  // Restore the first version.
  await page.getByTestId("file-plan.md").getByRole("button").first().click();
  await page
    .getByTestId("preview-dialog")
    .getByRole("button", { name: "Versions" })
    .click();
  await versions.getByTestId("restore-1").click();
  await expect(page.getByTestId("toast").last()).toContainText("Restored");
  await page.getByTestId("file-plan.md").getByRole("button").first().click();
  await expect(page.getByTestId("preview-text")).toContainText("- buy milk");
});

test("changes made in another browser sync in live", async ({
  browser,
  page,
  server,
}) => {
  const me = await server.createAccount("niclas");
  await signIn(page, me.pairingUri, "Laptop");
  await page.getByTestId("create-keys").click();
  const recoveryKey = await page.getByTestId("recovery-key").textContent();
  await page.getByTestId("rk-kept").check();
  await page.getByTestId("rk-done").click();
  await page.getByTestId("new-drive").click();
  await page.getByTestId("folder-name").fill("Family");
  await page.getByTestId("folder-create").click();
  await expect(page.getByRole("heading", { name: "Family" })).toBeVisible();

  // A second browser of the same account, unlocked with the recovery key.
  const other = await (await browser.newContext()).newPage();
  const second = await server.pairingFor(me.account.id);
  await signIn(other, second.pairingUri, "Desktop");
  await other.getByTestId("rk-input").fill(recoveryKey!);
  await other.getByTestId("rk-submit").click();
  await other.getByTestId("sidebar-folders").getByText("Family").click();
  await other
    .getByTestId("upload-input")
    .setInputFiles(text("shopping.txt", "bread"));
  await expect(other.getByTestId("file-shopping.txt")).toBeVisible();

  // It appears here without a reload, and in the activity feed.
  await expect(page.getByTestId("file-shopping.txt")).toBeVisible();
  await page.getByTestId("sync-status").click();
  await expect(page.getByTestId("activity")).toContainText("shopping.txt");
  await expect(page.getByTestId("activity")).toContainText("added in Family");
  await expect(page.getByTestId("sync-status")).toHaveText("Up to date");

  // Deleted over there: here too.
  await other
    .getByTestId("file-shopping.txt")
    .getByLabel(/Actions/)
    .click();
  await other.getByRole("button", { name: "Delete" }).click();
  await other.getByTestId("confirm-button").click();
  await expect(
    page.getByTestId("activity").locator("li").first(),
  ).toContainText("deleted in Family");

  // The server going away shows, and so does coming back.
  await server.faults.offline({ path: "/v1/namespaces" });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("sync-status")).toHaveText("Offline");
  await server.faults.clear();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("sync-status")).toHaveText("Up to date");

  // Signing out forgets this browser.
  await page.getByRole("link", { name: "This browser" }).click();
  await page.getByTestId("sign-out").click();
  await page.getByTestId("confirm-button").click();
  await expect(page.getByTestId("pair-payload")).toBeVisible();
});
