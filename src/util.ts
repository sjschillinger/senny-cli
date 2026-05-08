import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export function estimateTokens(value: string): number {
  if (!value) return 0;
  return Math.ceil(value.length / 3.5);
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 15))}...<truncated>`;
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

export function configHome(): string {
  if (process.env.SENNY_HOME) return process.env.SENNY_HOME;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "senny");
  return path.join(os.homedir(), ".config", "senny");
}

export function dataHome(): string {
  if (process.env.SENNY_DATA_HOME) return process.env.SENNY_DATA_HOME;
  if (process.env.XDG_DATA_HOME) return path.join(process.env.XDG_DATA_HOME, "senny");
  return path.join(os.homedir(), ".local", "share", "senny");
}

export function relativize(cwd: string, target: string): string {
  const rel = path.relative(cwd, path.resolve(cwd, target));
  return rel && !rel.startsWith("..") ? rel : target;
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file), `.tmp-${process.pid}-${Date.now()}`);
  await fs.writeFile(tmp, content, { mode: 0o600 });
  await fs.rename(tmp, file);
}
