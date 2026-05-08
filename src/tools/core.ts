import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Tool, ToolContext } from "../types.js";
import { relativize, truncate } from "../util.js";
import { analyzeCommand, analyzeParsedShell, isAutoApprovableCommand } from "../safety.js";
import { hasDangerousRedirect, parseShellFacts } from "../shell-parser.js";

const maxOutputChars = 32_768;

function asObject(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing required string argument: ${key}`);
  }
  return value;
}

function resolveInside(cwd: string, input: string): string {
  const resolved = path.resolve(cwd, input);
  const rel = path.relative(cwd, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes project root: ${input}`);
  }
  return resolved;
}

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a project file, optionally by 1-indexed line range.",
  mutates: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      start_line: { type: "number" },
      end_line: { type: "number" }
    },
    required: ["path"]
  },
  async run(raw, ctx) {
    const args = asObject(raw);
    const file = resolveInside(ctx.cwd, requiredString(args, "path"));
    const content = await fs.readFile(file, "utf8");
    const lines = content.split("\n");
    const start = Math.max(1, Number(args.start_line ?? 1));
    const end = Math.min(lines.length, Number(args.end_line ?? lines.length));
    if (start > end) return `Invalid range: start_line ${start} > end_line ${end}`;
    return lines
      .slice(start - 1, end)
      .map((line, offset) => `${start + offset} | ${line}`)
      .join("\n")
      .slice(0, maxOutputChars);
  },
  summarize(args) {
    const pathArg = String(asObject(args).path ?? "");
    return `read ${pathArg}`;
  }
};

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Write a complete file inside the project root.",
  mutates: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" }
    },
    required: ["path", "content"]
  },
  async run(raw, ctx) {
    const args = asObject(raw);
    const file = resolveInside(ctx.cwd, requiredString(args, "path"));
    const content = requiredString(args, "content");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    return `Wrote ${relativize(ctx.cwd, file)}`;
  },
  summarize(args) {
    return `wrote ${String(asObject(args).path ?? "")}`;
  }
};

export const targetEditTool: Tool = {
  name: "target_edit",
  description: "Replace one exact text block in a project file.",
  mutates: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      search: { type: "string" },
      replace: { type: "string" }
    },
    required: ["path", "search", "replace"]
  },
  async run(raw, ctx) {
    const args = asObject(raw);
    const file = resolveInside(ctx.cwd, requiredString(args, "path"));
    const search = requiredString(args, "search");
    const replace = requiredString(args, "replace");
    const original = await fs.readFile(file, "utf8");
    const count = original.split(search).length - 1;
    if (count !== 1) {
      return `Edit failed: expected exactly one match, found ${count}. Re-read the target file and retry with a narrower search block.`;
    }
    await fs.writeFile(file, original.replace(search, replace));
    return `Edited ${relativize(ctx.cwd, file)}`;
  },
  summarize(args) {
    return `edited ${String(asObject(args).path ?? "")}`;
  }
};

export const bashTool: Tool = {
  name: "bash",
  description: "Run a shell command in the project root. Mutating commands require unsafe mode.",
  mutates: true,
  requiresApproval(raw) {
    const args = asObject(raw);
    const command = typeof args.command === "string" ? args.command : "";
    return !isAutoApprovableCommand(command);
  },
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" }
    },
    required: ["command"]
  },
  async run(raw, ctx) {
    const args = asObject(raw);
    const command = requiredString(args, "command");
    const facts = await parseShellFacts(command);
    const analysis = analyzeParsedShell(command, hasDangerousRedirect(facts), facts.parseOK);
    if (analysis.risk === "dangerous") {
      throw new Error(`blocked command: ${analysis.reason}`);
    }
    return await runShell(command, ctx);
  },
  summarize(args) {
    return `ran ${String(asObject(args).command ?? "")}`;
  }
};

async function runShell(command: string, ctx: ToolContext): Promise<string> {
  return await new Promise((resolve, reject) => {
    const shell = process.platform === "win32" ? "powershell.exe" : "/bin/zsh";
    const shellArgs = process.platform === "win32" ? ["-NoProfile", "-Command", command] : ["-lc", command];
    const child = spawn(shell, shellArgs, { cwd: ctx.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk: Buffer) => {
      output = truncate(output + chunk.toString("utf8"), maxOutputChars);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const abort = () => {
      child.kill("SIGTERM");
    };
    ctx.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      ctx.signal?.removeEventListener("abort", abort);
      if (ctx.signal?.aborted) resolve(`${output}\nCommand cancelled.`.trim());
      else if (code && code !== 0) resolve(`${output}\nCommand exited with status ${code}.`.trim());
      else resolve(output.trim());
    });
  });
}

export function defaultTools(enabled: Record<string, boolean>): Tool[] {
  const candidates = [readFileTool, writeFileTool, targetEditTool, bashTool];
  return candidates.filter((tool) => enabled[tool.name] !== false);
}
