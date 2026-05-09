import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

test("SennyCoreClient exposes native config, MCP, tools, and permissions", { timeout: 5000 }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "senny-core-bridge-"));
  process.env.SENNY_SDK_TEST_TOKEN = "expanded";
  const client = await SennyCoreClient.start({ cwd });
  try {
    await mkdir(path.join(cwd, ".late"), { recursive: true });
    await writeFile(path.join(cwd, ".late", "mcp_config.json"), JSON.stringify({
      mcpServers: {
        demo: {
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "${SENNY_SDK_TEST_TOKEN}" }
        }
      }
    }));

    const config = await client.getConfig();
    assert.equal(config.openai.baseURL.length > 0, true);
    assert.equal(typeof config.enabledTools.read_file, "boolean");

    const mcp = await client.listMCP(cwd);
    assert.equal(mcp[0].name, "demo");
    assert.equal(mcp[0].env.TOKEN, "expanded");

    const tools = await client.listTools({ cwd, planning: false });
    assert.equal(tools.some((tool) => tool.name === "target_edit"), true);
    const planningTools = await client.listTools({ cwd, planning: true });
    assert.equal(planningTools.some((tool) => tool.name === "spawn_subagent"), true);

    assert.equal(await client.allowTool("write_file", "project", cwd), true);
    assert.equal(await client.allowCommand("git log --oneline", "project", cwd), true);
    const permissions = await client.listPermissions(cwd);
    assert.equal(permissions.tools.write_file, true);
    assert.equal(permissions.commands["git log"]["--oneline"], true);
  } finally {
    delete process.env.SENNY_SDK_TEST_TOKEN;
    await client.shutdown().catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
});

test("SennyCoreClient responds to core approval requests", { timeout: 5000 }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "senny-core-approval-"));
  const logPath = path.join(cwd, "approval.json");
  const fakeCore = path.join(cwd, "fake-core.mjs");
  await writeFile(fakeCore, `
    import readline from "node:readline";
    import { writeFile } from "node:fs/promises";
    const logPath = ${JSON.stringify(logPath)};
    const rl = readline.createInterface({ input: process.stdin });
    function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }
    rl.on("line", async (line) => {
      const req = JSON.parse(line);
      if (req.method === "initialize") send({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2026-05-08", serverName: "fake", serverVersion: "0", capabilities: ["approvals"] } });
      else if (req.method === "session/create") send({ jsonrpc: "2.0", id: req.id, result: { sessionId: "fake-session", cwd: process.cwd() } });
      else if (req.method === "session/run") {
        send({ jsonrpc: "2.0", id: req.id, result: { sessionId: "fake-session", status: "started" } });
        send({ jsonrpc: "2.0", method: "approval/request", params: { id: "approval-1", sessionId: "fake-session", kind: "command", command: "npm test", reason: "needs approval" } });
      } else if (req.method === "approval/respond") {
        await writeFile(logPath, JSON.stringify(req.params));
        send({ jsonrpc: "2.0", id: req.id, result: { ok: true } });
        send({ jsonrpc: "2.0", method: "session/event", params: { sessionId: "fake-session", type: "done", content: "ok" } });
      } else if (req.method === "shutdown") {
        send({ jsonrpc: "2.0", id: req.id, result: { status: "ok" } });
        process.exit(0);
      }
    });
  `);

  const client = await SennyCoreClient.start({
    command: process.execPath,
    args: [fakeCore],
    cwd,
    approvalHandler: async (request) => {
      assert.equal(request.command, "npm test");
      return { approved: true, scope: "project" };
    }
  });
  try {
    const session = await client.createSession({ cwd });
    await session.run("trigger approval");
    await waitFor(async () => {
      try {
        await readFile(logPath, "utf8");
        return true;
      } catch {
        return false;
      }
    });
    const logged = JSON.parse(await readFile(logPath, "utf8"));
    assert.deepEqual(logged, { id: "approval-1", approved: true, scope: "project" });
  } finally {
    await client.shutdown().catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
});

test("SennyCoreClient exposes session inspection and run compaction options", { timeout: 5000 }, async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "senny-core-inspect-"));
  const logPath = path.join(cwd, "run.json");
  const fakeCore = path.join(cwd, "fake-core.mjs");
  await writeFile(fakeCore, `
    import readline from "node:readline";
    import { writeFile } from "node:fs/promises";
    const logPath = ${JSON.stringify(logPath)};
    const rl = readline.createInterface({ input: process.stdin });
    function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n"); }
    rl.on("line", async (line) => {
      const req = JSON.parse(line);
      if (req.method === "initialize") send({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2026-05-08", serverName: "fake", serverVersion: "0", capabilities: ["session_inspect"] } });
      else if (req.method === "session/create") send({ jsonrpc: "2.0", id: req.id, result: { sessionId: "fake-session", cwd: process.cwd() } });
      else if (req.method === "session/run") {
        await writeFile(logPath, JSON.stringify(req.params));
        send({ jsonrpc: "2.0", id: req.id, result: { sessionId: "fake-session", status: "started" } });
        send({ jsonrpc: "2.0", method: "session/event", params: { sessionId: "fake-session", type: "compaction_started" } });
        send({ jsonrpc: "2.0", method: "session/event", params: { sessionId: "fake-session", type: "done", content: "ok" } });
      } else if (req.method === "session/inspect") {
        send({ jsonrpc: "2.0", id: req.id, result: { meta: { id: req.params.id }, audit: { path: "history.json", messages: 1, user_messages: 1, assistant_messages: 0, tool_result_messages: 0, tool_calls: 0, tool_names: [], compaction_boundaries: 0, compactions: [] } } });
      } else if (req.method === "shutdown") {
        send({ jsonrpc: "2.0", id: req.id, result: { status: "ok" } });
        process.exit(0);
      }
    });
  `);

  const client = await SennyCoreClient.start({ command: process.execPath, args: [fakeCore], cwd });
  const events = [];
  client.on("event", (event) => events.push(event));
  try {
    const session = await client.createSession({ cwd });
    await session.run("compact please", { forceCompaction: true, compactThresholdTokens: 10 });
    await waitFor(() => events.some((event) => event.type === "done"));
    const logged = JSON.parse(await readFile(logPath, "utf8"));
    assert.equal(logged.forceCompaction, true);
    assert.equal(logged.compactThresholdTokens, 10);
    const inspected = await client.inspectSession("fake-session");
    assert.equal(inspected.audit.messages, 1);
  } finally {
    await client.shutdown().catch(() => {});
    await rm(cwd, { recursive: true, force: true });
  }
});

async function waitFor(predicate) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > 2000) throw new Error("timed out waiting for core event");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
