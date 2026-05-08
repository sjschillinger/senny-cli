import { promises as fs } from "node:fs";
import path from "node:path";
import { pathExists, truncate } from "./util.js";

const memoryFiles = ["SENNY.md", "LATE.md", "AGENTS.md", path.join(".senny", "memory.md")];

export async function buildMemoryContext(cwd: string): Promise<string> {
  const blocks: string[] = [];
  for (const rel of memoryFiles) {
    const file = path.join(cwd, rel);
    if (!(await pathExists(file))) continue;
    const content = await fs.readFile(file, "utf8");
    blocks.push(`## Project Memory: ${rel}\n${truncate(content.trim(), 8000)}`);
  }
  if (blocks.length === 0) return "";
  return `# Senny Project Context\n${blocks.join("\n\n")}`;
}
