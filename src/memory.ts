import { promises as fs } from "node:fs";
import path from "node:path";
import { configHome, pathExists, truncate } from "./util.js";

const projectMemoryFiles = ["SENNY.md", "LATE.md", "AGENTS.md", path.join(".senny", "memory.md")];

export async function buildMemoryContext(cwd: string): Promise<string> {
  const blocks: string[] = [];

  // Global memory (~/.config/senny/MEMORY.md)
  const globalMemoryPath = path.join(configHome(), "MEMORY.md");
  if (await pathExists(globalMemoryPath)) {
    const content = await fs.readFile(globalMemoryPath, "utf8");
    if (content.trim()) {
      blocks.push(`## Global Memory\n${truncate(content.trim(), 2000)}`);
    }
  }

  // Project memory (all found files)
  for (const rel of projectMemoryFiles) {
    const file = path.join(cwd, rel);
    if (!(await pathExists(file))) continue;
    const content = await fs.readFile(file, "utf8");
    blocks.push(`## Project Memory: ${rel}\n${truncate(content.trim(), 8000)}`);
  }

  if (blocks.length === 0) return "";
  return `# Senny Project Context\n${blocks.join("\n\n")}`;
}
