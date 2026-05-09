import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { compactHistory } from "../dist/compact.js";
import { chatCompletionsURL } from "../dist/client.js";
import { readFileTool, targetEditTool, writeFileTool } from "../dist/tools/core.js";

async function tempProject() {
  return await mkdtemp(path.join(os.tmpdir(), "senny-test-"));
}

test("compactHistory preserves recent messages and summarizes older facts", () => {
  const history = Array.from({ length: 14 }, (_, index) => ({
    role: index % 3 === 0 ? "user" : index % 3 === 1 ? "assistant" : "tool",
    content: `message ${index}`
  }));
  const compacted = compactHistory(history);
  assert.equal(compacted.history.length, 8);
  assert.match(compacted.note, /Compacted Prior Conversation/);
  assert.match(compacted.note, /message 0/);
});

test("chatCompletionsURL accepts root or /v1 base URLs", () => {
  assert.equal(chatCompletionsURL("http://localhost:11434"), "http://localhost:11434/v1/chat/completions");
  assert.equal(chatCompletionsURL("http://localhost:11434/"), "http://localhost:11434/v1/chat/completions");
  assert.equal(chatCompletionsURL("http://localhost:11434/v1"), "http://localhost:11434/v1/chat/completions");
  assert.equal(chatCompletionsURL("http://localhost:11434/v1/"), "http://localhost:11434/v1/chat/completions");
});

test("target_edit replaces exactly one block", async () => {
  const cwd = await tempProject();
  try {
    await writeFile(path.join(cwd, "a.txt"), "alpha\nbeta\ngamma\n");
    const result = await targetEditTool.run({ path: "a.txt", search: "beta", replace: "BETA" }, { cwd, unsafe: true });
    assert.equal(result, "Edited a.txt");
    assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "alpha\nBETA\ngamma\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("target_edit rejects ambiguous matches", async () => {
  const cwd = await tempProject();
  try {
    await writeFile(path.join(cwd, "a.txt"), "x\nx\n");
    const result = await targetEditTool.run({ path: "a.txt", search: "x", replace: "y" }, { cwd, unsafe: true });
    assert.match(result, /expected exactly one match, found 2/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("file tools keep paths inside project root", async () => {
  const cwd = await tempProject();
  try {
    await assert.rejects(
      () => readFileTool.run({ path: "../outside.txt" }, { cwd, unsafe: true }),
      /path escapes project root/
    );
    await writeFileTool.run({ path: "inside.txt", content: "ok" }, { cwd, unsafe: true });
    assert.equal(await readFile(path.join(cwd, "inside.txt"), "utf8"), "ok");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
