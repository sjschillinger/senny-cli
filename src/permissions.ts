import path from "node:path";
import { promises as fs } from "node:fs";
import { atomicWrite, configHome, ensureDir } from "./util.js";

const projectApprovalTTL = 30 * 24 * 60 * 60 * 1000;
const globalApprovalTTL = 30 * 24 * 60 * 60 * 1000;
const sessionApprovalTTL = 30 * 60 * 1000;
const version = "0.1.0";

interface PersistedToolEntry {
  saved_at?: string;
  expires_at?: string;
  version?: string;
}

interface PersistedToolsFile {
  version?: string;
  entries?: Record<string, PersistedToolEntry>;
}

interface PersistedCommandEntry {
  flags: string[];
  saved_at?: string;
  expires_at?: string;
  version?: string;
}

interface PersistedCommandsFile {
  version?: string;
  entries?: Record<string, PersistedCommandEntry>;
}

const sessionTools = new Map<string, number>();
const sessionCommands = new Map<string, { flags: Set<string>; expiresAt: number }>();

export function parseCommandsForAllowList(command: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const segments = command.split(/\s*(?:&&|\|\||[|;])\s*/).map((segment) => segment.trim()).filter(Boolean);
  for (const segment of segments) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    let key = tokens[0];
    let start = 1;
    if (tokens[0] === "git" && tokens[1] && !tokens[1].startsWith("-")) {
      key = `git ${tokens[1]}`;
      start = 2;
    } else if (tokens[0] === "go" && tokens[1] && ["mod", "test"].includes(tokens[1])) {
      key = `go ${tokens[1]}`;
      start = 2;
    } else if (tokens[0] === "npm" && tokens[1] && !tokens[1].startsWith("-")) {
      key = `npm ${tokens[1]}`;
      start = 2;
    }
    const flags: string[] = [];
    for (const token of tokens.slice(start)) {
      if (token.startsWith("-")) flags.push(normalizeFlag(token));
      else if (key === "go mod" && token === "tidy") flags.push(token);
    }
    result[key] = [...(result[key] ?? []), ...flags];
  }
  return result;
}

export async function isToolAllowed(name: string): Promise<boolean> {
  cleanupSessionApprovals();
  if (sessionTools.has(name)) return true;
  const allowed = await loadAllAllowedTools();
  return allowed.has(name);
}

export async function allowTool(name: string, scope: "session" | "project" | "global" = "project"): Promise<void> {
  if (scope === "session") {
    sessionTools.set(name, Date.now() + sessionApprovalTTL);
    return;
  }
  const file = await loadToolsFile(toolPath(scope));
  const now = new Date();
  file.version = version;
  file.entries ??= {};
  file.entries[name] = {
    saved_at: now.toISOString(),
    expires_at: new Date(now.getTime() + (scope === "global" ? globalApprovalTTL : projectApprovalTTL)).toISOString(),
    version
  };
  await writeJSON(toolPath(scope), file);
}

export async function isCommandAllowed(command: string): Promise<boolean> {
  cleanupSessionApprovals();
  const requested = parseCommandsForAllowList(command);
  if (Object.keys(requested).length === 0) return false;
  const allowed = await loadAllAllowedCommands();
  for (const [cmd, flags] of Object.entries(requested)) {
    const allowedFlags = allowed.get(cmd);
    if (!allowedFlags) return false;
    for (const flag of flags) {
      if (!allowedFlags.has(flag) && !allowedFlags.has("-*")) return false;
    }
  }
  return true;
}

export async function allowCommand(command: string, scope: "session" | "project" | "global" = "project"): Promise<void> {
  const parsed = parseCommandsForAllowList(command);
  if (scope === "session") {
    const expiresAt = Date.now() + sessionApprovalTTL;
    for (const [cmd, flags] of Object.entries(parsed)) {
      const entry = sessionCommands.get(cmd) ?? { flags: new Set<string>(), expiresAt };
      flags.forEach((flag) => entry.flags.add(flag));
      entry.expiresAt = expiresAt;
      sessionCommands.set(cmd, entry);
    }
    return;
  }
  const file = await loadCommandsFile(commandPath(scope));
  const now = new Date();
  file.version = version;
  file.entries ??= {};
  for (const [cmd, flags] of Object.entries(parsed)) {
    const existing = file.entries[cmd];
    const merged = new Set([...(existing?.flags ?? []), ...flags]);
    file.entries[cmd] = {
      flags: [...merged].sort(),
      saved_at: now.toISOString(),
      expires_at: new Date(now.getTime() + (scope === "global" ? globalApprovalTTL : projectApprovalTTL)).toISOString(),
      version
    };
  }
  await writeJSON(commandPath(scope), file);
}

async function loadAllAllowedTools(): Promise<Set<string>> {
  cleanupSessionApprovals();
  const allowed = new Set<string>(sessionTools.keys());
  for (const scope of ["global", "project"] as const) {
    const file = await loadToolsFile(toolPath(scope));
    for (const [name, entry] of Object.entries(file.entries ?? {})) {
      if (isEntryValid(entry.expires_at, entry.version ?? file.version)) allowed.add(name);
    }
  }
  return allowed;
}

async function loadAllAllowedCommands(): Promise<Map<string, Set<string>>> {
  cleanupSessionApprovals();
  const allowed = new Map<string, Set<string>>();
  for (const [cmd, entry] of sessionCommands) allowed.set(cmd, new Set(entry.flags));
  for (const scope of ["global", "project"] as const) {
    const file = await loadCommandsFile(commandPath(scope));
    for (const [cmd, entry] of Object.entries(file.entries ?? {})) {
      if (!isEntryValid(entry.expires_at, entry.version ?? file.version)) continue;
      const flags = allowed.get(cmd) ?? new Set<string>();
      entry.flags.forEach((flag) => flags.add(flag));
      allowed.set(cmd, flags);
    }
  }
  return allowed;
}

function cleanupSessionApprovals(): void {
  const now = Date.now();
  for (const [name, expiresAt] of sessionTools) if (expiresAt < now) sessionTools.delete(name);
  for (const [cmd, entry] of sessionCommands) if (entry.expiresAt < now) sessionCommands.delete(cmd);
}

function isEntryValid(expiresAt?: string, entryVersion?: string): boolean {
  if (entryVersion && entryVersion !== version) return false;
  if (!expiresAt) return true;
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time >= Date.now();
}

function toolPath(scope: "project" | "global"): string {
  return scope === "global" ? path.join(configHome(), "allowed_tools.json") : path.join(process.cwd(), ".late", "allowed_tools.json");
}

function commandPath(scope: "project" | "global"): string {
  return scope === "global" ? path.join(configHome(), "allowed_commands.json") : path.join(process.cwd(), ".late", "allowed_commands.json");
}

async function loadToolsFile(file: string): Promise<PersistedToolsFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as PersistedToolsFile | string[];
    if (Array.isArray(parsed)) {
      return { version, entries: Object.fromEntries(parsed.map((name) => [name, { version }])) };
    }
    return { version: parsed.version, entries: parsed.entries ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version, entries: {} };
    throw err;
  }
}

async function loadCommandsFile(file: string): Promise<PersistedCommandsFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    if (isPersistedCommandsFile(parsed)) {
      return { version: parsed.version, entries: parsed.entries ?? {} };
    }
    if (typeof parsed === "object" && parsed !== null) {
      const legacy = parsed as Record<string, string[]>;
      return {
        version,
        entries: Object.fromEntries(Object.entries(legacy).map(([cmd, flags]) => [cmd, { flags: Array.isArray(flags) ? flags : [], version }]))
      };
    }
    return { version, entries: {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version, entries: {} };
    throw err;
  }
}

function isPersistedCommandsFile(value: unknown): value is PersistedCommandsFile {
  return typeof value === "object" && value !== null && "entries" in value;
}

async function writeJSON(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await atomicWrite(file, JSON.stringify(value, null, 2));
}

function normalizeFlag(value: string): string {
  if (/^-\d+$/.test(value)) return "-*";
  const eq = value.indexOf("=");
  return eq === -1 ? value : value.slice(0, eq);
}

function tokenize(command: string): string[] {
  const matches = command.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}
