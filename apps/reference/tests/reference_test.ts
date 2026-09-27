import {
  addTodo,
  createNamespace,
  expect,
  newDevice,
  pair,
  person,
  selectNamespace,
  test,
  todo,
} from "./fixtures.ts";

test("first device: pair, create the account key, keep data in a namespace", async ({
  server,
  browser,
}) => {
  const { page, recoveryKey } = await person(server, browser, "alice");
  expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{4}$/);
  await createNamespace(page, "Home");
  await selectNamespace(page, "Home");
  await addTodo(page, "Buy milk");
  await expect(todo(page, "Buy milk")).toBeVisible();
  await expect(page.getByTestId("todo-status")).toHaveText("synced");
  await page.getByTestId("note-new-name").fill("groceries.md");
  await page.getByTestId("note-create").click();
  await page.getByTestId("note-text").fill("- milk\n- bread");
  await page.getByTestId("note-save").click();
  await expect(
    page
      .getByTestId("log-entry")
      .filter({ hasText: "saved notes/groceries.md" }),
  ).toBeVisible();
  // A reload restores the session from the key vault: no pairing again.
  await page.reload();
  await expect(page.getByTestId("state")).toHaveText("ready");
  await expect(
    page.getByTestId("namespace-item").filter({ hasText: "Home" }),
  ).toBeVisible();
});

test("a second device from an add-device link is ready at once and syncs live", async ({
  server,
  browser,
}) => {
  const { page: laptop } = await person(server, browser, "alice");
  await createNamespace(laptop, "Home");
  await selectNamespace(laptop, "Home");
  await laptop.getByTestId("add-device").click();
  const link = await laptop.getByTestId("add-device-payload").inputValue();
  expect(link).toMatch(/^http:\/\/localhost:4173\/#oss=/);

  const phone = await newDevice(
    browser,
    link.replace("http://localhost:4173", ""),
  );
  await expect(phone.getByTestId("pair-input")).toHaveValue(/#oss=/);
  await phone.getByTestId("pair-submit").click();
  await expect(phone.getByTestId("state")).toHaveText("ready");
  await selectNamespace(phone, "Home");

  await addTodo(laptop, "From laptop");
  await expect(todo(phone, "From laptop")).toBeVisible();
  await addTodo(phone, "From phone");
  await expect(todo(laptop, "From phone")).toBeVisible();
  // Tick on one device, see it on the other.
  await todo(phone, "From laptop").getByTestId("todo-toggle").check();
  await expect(todo(laptop, "From laptop")).toHaveAttribute("data-done", "yes");
});

test("a device paired from the server's code is approved after comparing safety codes", async ({
  server,
  browser,
}) => {
  const { page: laptop, accountId } = await person(server, browser, "alice");
  const code = await server.pairingFor(accountId);
  const tablet = await newDevice(browser);
  await pair(tablet, code.pairingUri, "tablet");
  const safety = (await tablet.getByTestId("safety-code").textContent())!;
  await laptop.getByTestId("refresh-devices").click();
  await expect(laptop.getByTestId("pending-code")).toHaveText(safety);
  await laptop.getByTestId("approve-device").click();
  await expect(tablet.getByTestId("state")).toHaveText("ready", {
    timeout: 15_000,
  });
});

test("the recovery key brings everything back on a new device", async ({
  server,
  browser,
}) => {
  const {
    page: laptop,
    recoveryKey,
    accountId,
  } = await person(server, browser, "alice");
  await createNamespace(laptop, "Health");
  await selectNamespace(laptop, "Health");
  await addTodo(laptop, "Book check-up");
  await expect(laptop.getByTestId("todo-status")).toHaveText("synced");
  const code = await server.pairingFor(accountId);
  const fresh = await newDevice(browser);
  await pair(fresh, code.pairingUri, "new phone");
  await fresh
    .getByTestId("recovery-input")
    .fill(recoveryKey.toLowerCase().replaceAll("-", " "));
  await fresh.getByTestId("recover-submit").click();
  await expect(fresh.getByTestId("state")).toHaveText("ready");
  await selectNamespace(fresh, "Health");
  await expect(todo(fresh, "Book check-up")).toBeVisible();
});

test("editing the same note on two devices shows a conflict instead of losing an edit", async ({
  server,
  browser,
}) => {
  const { page: a } = await person(server, browser, "alice");
  await createNamespace(a, "Notes");
  await selectNamespace(a, "Notes");
  await a.getByTestId("note-new-name").fill("plan.md");
  await a.getByTestId("note-create").click();
  await a.getByTestId("note-text").fill("v1");
  await a.getByTestId("note-save").click();
  await a.getByTestId("add-device").click();
  const link = await a.getByTestId("add-device-payload").inputValue();
  const b = await newDevice(browser, link.replace("http://localhost:4173", ""));
  await b.getByTestId("pair-submit").click();
  await selectNamespace(b, "Notes");
  await b
    .locator('[data-testid="note-item"][data-path="notes/plan.md"]')
    .click();
  await expect(b.getByTestId("note-text")).toHaveValue("v1");
  await a.getByTestId("note-text").fill("edited on A");
  await a.getByTestId("note-save").click();
  await b.getByTestId("note-text").fill("edited on B");
  await b.getByTestId("note-save").click();
  await expect(b.getByTestId("note-conflict")).toBeVisible();
  await expect(b.getByTestId("note-theirs")).toHaveText("edited on A");
  await b.getByTestId("conflict-keep-mine").click();
  await expect(b.getByTestId("note-conflict")).toBeHidden();
  await a
    .locator('[data-testid="note-item"][data-path="notes/plan.md"]')
    .click();
  await expect(a.getByTestId("note-text")).toHaveValue("edited on B");
});

test("share one namespace with a guest; removing them rotates the key", async ({
  server,
  browser,
}) => {
  const { page: owner } = await person(server, browser, "mum");
  await createNamespace(owner, "Medication");
  await createNamespace(owner, "Private");
  await selectNamespace(owner, "Medication");
  await addTodo(owner, "Levaxin 08:00");
  await owner.getByTestId("invite-role").selectOption("viewer");
  await owner.getByTestId("invite-create").click();
  const link = await owner.getByTestId("invite-payload").inputValue();

  const carer = await newDevice(
    browser,
    link.replace("http://localhost:4173", ""),
  );
  await carer.getByTestId("guest-name").fill("Carer");
  await carer.getByTestId("pair-submit").click();
  await expect(carer.getByTestId("state")).toHaveText("ready");
  await expect(carer.getByTestId("guest-recovery-key")).toBeVisible();
  await expect(carer.getByTestId("namespace-item")).toHaveCount(1);
  await selectNamespace(carer, "Medication");
  await expect(todo(carer, "Levaxin 08:00")).toBeVisible();
  await expect(carer.getByTestId("todo-new")).toHaveCount(0); // viewer

  await owner
    .locator('[data-testid="member-item"][data-name="Carer"]')
    .getByTestId("member-remove")
    .click();
  await expect(owner.getByTestId("epoch")).toHaveText("epoch 2");
  await carer.reload();
  await expect(carer.getByTestId("namespace-item")).toHaveCount(0);
});

test("going offline: edits wait, then sync when the server is back", async ({
  server,
  browser,
}) => {
  const { page } = await person(server, browser, "alice");
  await createNamespace(page, "Offline");
  await selectNamespace(page, "Offline");
  await server.faults.offline({ path: "/v1/ns/" });
  await addTodo(page, "Written offline");
  await expect(page.getByTestId("todo-status")).toHaveText(/error|pending/);
  await server.faults.clear();
  await addTodo(page, "Back online");
  await expect(page.getByTestId("todo-status")).toHaveText("synced", {
    timeout: 15_000,
  });
  await page.reload();
  await selectNamespace(page, "Offline");
  await expect(todo(page, "Written offline")).toBeVisible();
});
