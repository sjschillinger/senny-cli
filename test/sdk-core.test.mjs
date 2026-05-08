import test from "node:test";
import assert from "node:assert/strict";
import { SennyCoreClient } from "../dist/sdk/index.js";

test("SennyCoreClient starts Go core and runs a session", { timeout: 5000 }, async () => {
  const client = await SennyCoreClient.start({ cwd: process.cwd() });
  const events = [];
  client.on("event", (event) => events.push(event));
  try {
    const session = await client.createSession({ cwd: process.cwd(), model: "__mock__" });
    assert.match(session.id, /^session-/);
    const run = await session.run("hello from sdk");
    assert.equal(run.status, "started");
    await waitFor(() => events.some((event) => event.type === "done"));
    assert.equal(events.some((event) => event.type === "turn_start"), true);
    assert.equal(events.some((event) => event.type === "done"), true);
  } finally {
    await client.shutdown().catch(() => {});
  }
});

async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) throw new Error("timed out waiting for core event");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
