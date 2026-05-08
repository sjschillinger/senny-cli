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
  try {
    await allowTool("write_file", "project", cwd);
    assert.equal(await isToolAllowed("write_file", cwd), true);
    await allowCommand("git log --oneline", "project", cwd);
    assert.equal(await isCommandAllowed("git log --oneline", cwd), true);
    assert.equal(await isCommandAllowed("git log --graph", cwd), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("project allow-lists honor explicit cwd", async () => {
  const cwdA = await mkdtemp(path.join(os.tmpdir(), "senny-perms-a-"));
  const cwdB = await mkdtemp(path.join(os.tmpdir(), "senny-perms-b-"));
  try {
    await allowTool("target_edit", "project", cwdA);
    assert.equal(await isToolAllowed("target_edit", cwdA), true);
    assert.equal(await isToolAllowed("target_edit", cwdB), false);
  } finally {
    await rm(cwdA, { recursive: true, force: true });
    await rm(cwdB, { recursive: true, force: true });
  }
});
