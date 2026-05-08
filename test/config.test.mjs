import test from "node:test";
import assert from "node:assert/strict";
import { expandEnvVars, loadConfig, loadLateMCPConfig, validateConfig } from "../dist/config.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const valid = {
  openAIBaseURL: "http://localhost:8080",
  openAIAPIKey: "",
  openAIModel: "",
  subagentBaseURL: "http://localhost:8080",
  subagentAPIKey: "",
  subagentModel: "",
  enabledTools: {},
  maxTurns: 10,
  compactAfterTokens: 5000,
  approvalMode: "ask",
  mcpServers: {}
};

test("validateConfig accepts a valid config", () => {
  assert.doesNotThrow(() => validateConfig(valid));
});

test("validateConfig rejects malformed MCP server entries", () => {
  assert.throws(() => validateConfig({ ...valid, mcpServers: { bad: { command: "" } } }), /command is required/);
});

test("expandEnvVars replaces ${VAR} references", () => {
  process.env.SENNY_TEST_VALUE = "ok";
  assert.equal(expandEnvVars("x-${SENNY_TEST_VALUE}"), "x-ok");
});

test("loadLateMCPConfig reads project .late config first", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "senny-mcp-"));
  try {
    await mkdir(path.join(cwd, ".late"), { recursive: true });
    await writeFile(path.join(cwd, ".late", "mcp_config.json"), JSON.stringify({ mcpServers: { demo: { command: "node", args: ["x"] } } }));
    const config = await loadLateMCPConfig(cwd);
    assert.equal(config.demo.command, "node");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadConfig honors explicit cwd for project MCP config", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "senny-config-cwd-"));
  const home = await mkdtemp(path.join(os.tmpdir(), "senny-home-"));
  const oldHome = process.env.SENNY_HOME;
  process.env.SENNY_HOME = home;
  try {
    await mkdir(path.join(cwd, ".late"), { recursive: true });
    await writeFile(path.join(cwd, ".late", "mcp_config.json"), JSON.stringify({ mcpServers: { cwdDemo: { command: "node", args: ["x"] } } }));
    const config = await loadConfig(cwd);
    assert.equal(config.mcpServers.cwdDemo.command, "node");
  } finally {
    if (oldHome === undefined) delete process.env.SENNY_HOME;
    else process.env.SENNY_HOME = oldHome;
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
