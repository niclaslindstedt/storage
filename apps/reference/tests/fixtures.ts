// Fixtures: the test server's controls, and "a person with a ready device".

import {
  expect,
  test as base,
  type Browser,
  type Page,
} from "@playwright/test";

import {
  connectTestServer,
  type TestServer,
} from "../../../packages/testkit/src/index.ts";
import { SERVER_URL, TEST_SECRET } from "../playwright.config.ts";

export const test = base.extend<{ server: TestServer }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take no dependencies this way
  server: async ({}, use) => {
    const server = connectTestServer(SERVER_URL, TEST_SECRET);
    await server.reset();
    await use(server);
    await server.faults.clear();
  },
});

export { expect };

/** Open the app in a fresh context (= a fresh device). */
export async function newDevice(browser: Browser, path = "/"): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

/** Pair a device with a code and wait for the given state. */
export async function pair(
  page: Page,
  code: string,
  deviceName = "browser",
): Promise<void> {
  await page.getByTestId("pair-input").fill(code);
  await page.getByTestId("device-name").fill(deviceName);
  await page.getByTestId("pair-submit").click();
}

/** A person with one ready device, and the recovery key it showed. */
export async function person(
  server: TestServer,
  browser: Browser,
  name: string,
): Promise<{ page: Page; recoveryKey: string; accountId: string }> {
  const seeded = await server.createAccount(name);
  const page = await newDevice(browser);
  await pair(page, seeded.pairingUri, `${name}'s laptop`);
  await page.getByTestId("create-keys").click();
  const recoveryKey = (await page.getByTestId("recovery-key").textContent())!;
  await page.getByTestId("recovery-saved").click();
  await expect(page.getByTestId("state")).toHaveText("ready");
  return { page, recoveryKey, accountId: seeded.account.id };
}

export async function createNamespace(page: Page, name: string): Promise<void> {
  await page.getByTestId("namespace-name").fill(name);
  await page.getByTestId("namespace-create").click();
  await expect(
    page.getByTestId("namespace-item").filter({ hasText: name }),
  ).toBeVisible();
}

export async function selectNamespace(page: Page, name: string): Promise<void> {
  const item = page.locator(
    `[data-testid="namespace-item"][data-name="${name}"]`,
  );
  await item.click();
  await expect(item).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "To-do" })).toBeVisible();
}

export async function addTodo(page: Page, title: string): Promise<void> {
  await page.getByTestId("todo-new").fill(title);
  await page.getByTestId("todo-add").click();
}

export function todo(page: Page, title: string) {
  return page.locator(`[data-testid="todo-item"][data-title="${title}"]`);
}
