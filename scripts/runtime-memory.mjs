#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SennyCoreClient } from "../dist/sdk/index.js";

const execFileAsync = promisify(execFile);

const client = await SennyCoreClient.start({ cwd: process.cwd() });
try {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const nodeRSS = process.memoryUsage().rss;
  const corePID = client.pid;
  const coreRSS = corePID ? await rssForPID(corePID) : 0;
  const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`;
  const result = {
    runtime,
    wrapperPid: process.pid,
    corePid: corePID,
    wrapperRssMB: toMB(nodeRSS),
    coreRssMB: toMB(coreRSS),
    totalRssMB: toMB(nodeRSS + coreRSS)
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.shutdown().catch(() => undefined);
}

async function rssForPID(pid) {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)]);
    const kb = Number(stdout.trim());
    return Number.isFinite(kb) ? kb * 1024 : 0;
  } catch {
    return 0;
  }
}

function toMB(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}
