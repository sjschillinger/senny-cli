import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Session, formatSessionDisplay, listSessions, resolveSessionID } from "../dist/session.js";
import { ToolRegistry } from "../dist/tools/registry.js";

class FakeClient {
  async *streamChat() {}
}

test("session save writes history and discoverable metadata", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "senny-home-"));
  const oldData = process.env.SENNY_DATA_HOME;
  process.env.SENNY_DATA_HOME = home;
  try {
    const session = new Session(new FakeClient(), new ToolRegistry(), process.cwd(), "system", 10000, [], "abc123");
    await session.add({ role: "user", content: "Build a thing" });
    await session.add({ role: "assistant", content: "On it" });
    const sessions = await listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, "abc123");
    assert.equal(sessions[0].message_count, 2);
    assert.equal(await resolveSessionID("abc"), "abc123");
    assert.match(formatSessionDisplay(sessions[0]), /abc123\tBuild a thing\t/);
  } finally {
    if (oldData === undefined) delete process.env.SENNY_DATA_HOME;
    else process.env.SENNY_DATA_HOME = oldData;
    await rm(home, { recursive: true, force: true });
  }
});
