import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { allowCommand, allowTool, isCommandAllowed, isToolAllowed, parseCommandsForAllowList } from "../dist/permissions.js";

test("parseCommandsForAllowList extracts command keys and flags", () => {
  assert.deepEqual(parseCommandsForAllowList("go mod tidy && go test -v ./..."), {
    "go mod": ["tidy"],
    "go test": ["-v"]
  });
  assert.deepEqual(parseCommandsForAllowList("git log --oneline --output=test.txt | grep foo"), {
    "git log": ["--oneline", "--output"],
    grep: []
  });
});

test("project command and tool allow-lists persist", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "senny-perms-"));
  const oldCwd = process.cwd();
  process.chdir(cwd);
  try {
    await allowTool("write_file", "project");
    assert.equal(await isToolAllowed("write_file"), true);
    await allowCommand("git log --oneline", "project");
    assert.equal(await isCommandAllowed("git log --oneline"), true);
    assert.equal(await isCommandAllowed("git log --graph"), false);
  } finally {
    process.chdir(oldCwd);
    await rm(cwd, { recursive: true, force: true });
  }
});
