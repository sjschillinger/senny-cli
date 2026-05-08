import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("migrate senny copies .late project state without deleting source", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "senny-migrate-"));
  try {
    await mkdir(path.join(cwd, ".late"), { recursive: true });
    await writeFile(path.join(cwd, ".late", "mcp_config.json"), JSON.stringify({ mcpServers: { demo: { command: "node" } } }));
    await execFileAsync(process.execPath, [path.resolve("dist/cli.js"), "--cwd", cwd, "migrate", "senny"]);

    const migrated = JSON.parse(await readFile(path.join(cwd, ".senny", "mcp_config.json"), "utf8"));
    const source = JSON.parse(await readFile(path.join(cwd, ".late", "mcp_config.json"), "utf8"));
    assert.equal(migrated.mcpServers.demo.command, "node");
    assert.equal(source.mcpServers.demo.command, "node");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
