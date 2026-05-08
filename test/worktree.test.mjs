import test from "node:test";
import assert from "node:assert/strict";
import { parseWorktreeList } from "../dist/worktree.js";

test("parseWorktreeList extracts branch and status", () => {
  const parsed = parseWorktreeList("/repo  abc123 [main]\n/wt  def456 [feature]\n# dirty\n");
  assert.deepEqual(parsed, [
    { path: "/repo", branch: "main", isDetached: false, status: "" },
    { path: "/wt", branch: "feature", isDetached: false, status: "dirty" }
  ]);
});
