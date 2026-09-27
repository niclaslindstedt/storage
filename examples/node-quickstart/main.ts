// Quickstart: two people, one shared, end-to-end encrypted namespace.
//
// Starts an in-memory server, pairs a device for Mum and one for her carer,
// shares ONE namespace (not the account), syncs a medication list with a
// row-level merge, and proves the server only ever held ciphertext.
//
//   make build && npm run --prefix examples/node-quickstart start

import {
  createMemoryKeyVault,
  createSelfHostedClient,
} from "@niclaslindstedt/oss-framework/storage";
import { startTestServer } from "@niclaslindstedt/storage-testkit";

type Medication = {
  name: string;
  dose: string;
  schedule: string[];
  updatedAt: string;
};

const server = await startTestServer();
try {
  // 1. Mum pairs her phone. In real life she scans the QR that
  //    `storage-server pair --new mum` prints; here the testkit mints it.
  const seeded = await server.createAccount("mum");
  const mum = createSelfHostedClient({
    app: "meds",
    vault: createMemoryKeyVault(),
  });
  await mum.pair(seeded.pairingUri, { name: "Mum's phone", platform: "ios" });
  const recoveryKey = await mum.createAccountKeys();
  console.log(`paired; recovery key ${recoveryKey.slice(0, 9)}…`);

  // 2. She creates a namespace and writes an encrypted record.
  const meds = await mum.createNamespace({ name: "Mum's medication" });
  await meds.records<Medication>("medications").put("levaxin", {
    name: "Levaxin",
    dose: "50µg",
    schedule: ["07:00"],
    updatedAt: new Date().toISOString(),
  });

  // 3. She invites her carer to that namespace only. The carer has no
  //    account: the invite QR creates a guest account scoped to it.
  const { payload } = await meds.invite({ role: "editor" });
  const carer = createSelfHostedClient({
    app: "meds",
    vault: createMemoryKeyVault(),
  });
  const { namespace } = await carer.acceptInvite(payload, {
    accountName: "Carer",
    device: { name: "Carer's tablet" },
  });
  console.log(`carer joined "${namespace.meta.name}" as ${namespace.role}`);

  // 4. Both edit the same row without syncing in between: Mum changes the
  //    dose, the carer adds an evening time. The row-level merge keeps both.
  const mine = meds.recordStore<Medication>("medications");
  const theirs = namespace.recordStore<Medication>("medications");
  await mine.sync();
  await theirs.sync();
  const now = Date.now();
  mine.set("levaxin", {
    ...mine.get("levaxin")!,
    dose: "75µg",
    updatedAt: new Date(now).toISOString(),
  });
  theirs.set("levaxin", {
    ...theirs.get("levaxin")!,
    schedule: ["07:00", "19:00"],
    updatedAt: new Date(now + 1000).toISOString(),
  });
  await mine.sync();
  const { merged } = await theirs.sync();
  await mine.sync();
  console.log(`merged ${merged} row:`, mine.get("levaxin"));

  // 5. The server holds ciphertext only: no name, dose or collection name.
  const dump = JSON.stringify(await server.snapshot());
  for (const plain of ["Levaxin", "75µg", "medications", "Mum's medication"])
    if (dump.includes(plain)) throw new Error(`server saw "${plain}"`);
  console.log("server snapshot contains no plaintext ✓");

  await mum.signOut();
  await carer.signOut();
} finally {
  await server.close();
}
