#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const baseURL = process.env.OPENAI_BASE_URL;
if (!baseURL) {
  console.error("OPENAI_BASE_URL is required for the real-model smoke test.");
  process.exit(2);
}

const cwd = await mkdtemp(path.join(os.tmpdir(), "senny-smoke-"));
const prompt = process.env.SENNY_SMOKE_PROMPT ?? "Inspect the project and reply with exactly: Senny smoke ok";
const timeoutMs = Number(process.env.SENNY_SMOKE_TIMEOUT_MS ?? 120000);
await writeFile(path.join(cwd, "README.md"), "# Smoke Project\n\nTiny project for Senny smoke testing.\n");

const child = spawn(process.execPath, [path.resolve("dist/cli.js"), "--cwd", cwd, "--yes", prompt], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString("utf8");
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

const timer = setTimeout(() => {
  child.kill("SIGTERM");
}, timeoutMs);

try {
  const code = await new Promise((resolve) => child.on("exit", resolve));
  if (code !== 0) {
    console.error(stderr || stdout);
    process.exit(typeof code === "number" ? code : 1);
  }
  console.log(stdout.trim());
} finally {
  clearTimeout(timer);
  await rm(cwd, { recursive: true, force: true });
}
