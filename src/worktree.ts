import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  branch: string;
  isDetached: boolean;
  status: string;
}

export async function listWorktrees(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["worktree", "list"], { cwd });
  return formatWorktrees(parseWorktreeList(stdout));
}

export async function activeWorktree(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["worktree", "list"], { cwd });
  const worktrees = parseWorktreeList(stdout);
  const top = (await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd })).stdout.trim();
  return worktrees.find((worktree) => worktree.path === top)?.path ?? top;
}

export async function createWorktree(cwd: string, target: string, branch?: string): Promise<string> {
  const args = ["worktree", "add", target];
  if (branch) args.push(branch);
  const { stdout, stderr } = await execFileAsync("git", args, { cwd });
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

export async function removeWorktree(cwd: string, target: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", ["worktree", "remove", target], { cwd });
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

export function parseWorktreeList(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  const lines = output.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^(\S+)\s+([a-f0-9]+)\s+(?:\[([^\]]*)\])?/.exec(line);
    if (!match) continue;
    const branch = match[3] ?? match[2];
    const isDetached = !match[3] || /^[a-f0-9]{40}$/.test(match[3]);
    let status = "";
    if (lines[index + 1]?.startsWith("# ")) {
      status = lines[index + 1].slice(2);
      index += 1;
    }
    worktrees.push({ path: match[1], branch, isDetached, status });
  }
  return worktrees;
}

export function formatWorktrees(worktrees: WorktreeInfo[]): string {
  return worktrees.map((worktree) => {
    const branch = worktree.isDetached ? `(detached ${worktree.branch})` : `[${worktree.branch}]`;
    return [worktree.path, branch, worktree.status].filter(Boolean).join("\t");
  }).join("\n");
}
