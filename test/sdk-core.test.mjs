import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) throw new Error("timed out waiting for core event");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
