import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import YAML from "yaml";
import type { JsonSchema, Tool, ToolContext } from "./types.js";
import type { ToolRegistry } from "./tools/registry.js";
import { configHome, truncate } from "./util.js";

export interface SkillArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface SkillMetadata {
  name: string;
  description: string;
  when_to_use?: string;
  effort?: "short" | "medium" | "long";
  tags?: string[];
  arguments?: SkillArgument[];
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  "allowed-tools"?: string;
}

export interface Skill {
  path: string;
  metadata: SkillMetadata;
  instructions: string;
}

export async function loadSkill(skillDir: string): Promise<Skill> {
  const skillFile = path.join(skillDir, "SKILL.md");
  const content = await fs.readFile(skillFile, "utf8");
  const { metadata, body } = parseSkillFile(content);
  if (!metadata.name) throw new Error(`SKILL.md in ${skillDir} is missing name`);
  if (!metadata.description) throw new Error(`SKILL.md in ${skillDir} is missing description`);
  if (metadata.name !== path.basename(skillDir)) {
    throw new Error(`skill name '${metadata.name}' does not match directory '${path.basename(skillDir)}'`);
  }
  return { path: skillDir, metadata, instructions: body.trim() };
}

export function parseSkillFile(content: string): { metadata: SkillMetadata; body: string } {
  if (!content.startsWith("---\n")) throw new Error("SKILL.md must start with YAML frontmatter");
  const end = content.indexOf("\n---", 4);
  if (end === -1) throw new Error("SKILL.md frontmatter must close with ---");
  const frontmatter = content.slice(4, end);
  const bodyStart = content.indexOf("\n", end + 4);
  const body = bodyStart === -1 ? "" : content.slice(bodyStart + 1);
  return { metadata: YAML.parse(frontmatter) as SkillMetadata, body };
}

export async function discoverSkills(dirs: string[]): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        skills.push(await loadSkill(path.join(dir, entry.name)));
      } catch {
        // Match Late behavior: skip malformed skill directories.
      }
    }
  }
  return skills;
}

export function defaultSkillDirs(cwd: string): string[] {
  return [path.join(configHome(), "skills"), path.join(cwd, ".late", "skills"), path.join(cwd, ".senny", "skills")];
}

export function registerActivateSkillTool(registry: ToolRegistry, skills: Skill[]): void {
  if (skills.length === 0) return;
  const skillMap = new Map(skills.map((skill) => [skill.metadata.name, skill]));
  registry.register({
    name: "activate_skill",
    description: `Activate a skill by name to see its instructions and enable its scripts as tools. Available: ${skills
      .map((skill) => {
        let desc = `${skill.metadata.name}: ${skill.metadata.description}`;
        if (skill.metadata.when_to_use) desc += ` (use when: ${skill.metadata.when_to_use})`;
        if (skill.metadata.effort) desc += ` [effort: ${skill.metadata.effort}]`;
        return desc;
      })
      .join("; ")}`,
    mutates: false,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: skills.map((skill) => skill.metadata.name)
        }
      },
      required: ["name"]
    },
    run: async (raw) => {
      const args = asRecord(raw);
      const name = String(args.name ?? "");
      const skill = skillMap.get(name);
      if (!skill) return `Skill '${name}' not found`;
      await registerSkillScripts(registry, skill);
      return `Skill '${skill.metadata.name}' activated.\n\nInstructions:\n${skill.instructions}`;
    },
    summarize: (args) => `activated skill ${String(asRecord(args).name ?? "")}`
  });
}

async function registerSkillScripts(registry: ToolRegistry, skill: Skill): Promise<void> {
  const scriptsDir = path.join(skill.path, "scripts");
  let entries;
  try {
    entries = await fs.readdir(scriptsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const scriptPath = path.join(scriptsDir, entry.name);
    registry.register(scriptTool(skill.metadata.name, entry.name, scriptPath));
  }
}

function scriptTool(skillName: string, scriptName: string, scriptPath: string): Tool {
  return {
    name: `skill_${sanitizeToolName(skillName)}_${sanitizeToolName(scriptName)}`,
    description: `Execute the '${scriptName}' script from the '${skillName}' skill.`,
    mutates: true,
    parameters: {
      type: "object",
      properties: {
        args: { type: "array", items: { type: "string" } }
      }
    } satisfies JsonSchema,
    run: async (raw, ctx) => runScript(scriptPath, Array.isArray(asRecord(raw).args) ? (asRecord(raw).args as string[]) : [], ctx),
    summarize: () => `ran skill script ${skillName}/${scriptName}`
  };
}

async function runScript(scriptPath: string, args: string[], ctx: ToolContext): Promise<string> {
  return await new Promise((resolve, reject) => {
    const ext = path.extname(scriptPath);
    const command = ext === ".py" ? "python3" : ext === ".js" ? "node" : scriptPath;
    const commandArgs = ext === ".py" || ext === ".js" ? [scriptPath, ...args] : args;
    const child = spawn(command, commandArgs, { cwd: ctx.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk: Buffer) => {
      output = truncate(output + chunk.toString("utf8"), 32_768);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const abort = () => child.kill("SIGTERM");
    ctx.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      ctx.signal?.removeEventListener("abort", abort);
      if (ctx.signal?.aborted) resolve(`${output}\nScript cancelled.`.trim());
      else if (code && code !== 0) resolve(`Script failed with status ${code}.\n${output}`.trim());
      else resolve(output.trim());
    });
  });
}

function sanitizeToolName(name: string): string {
  return name.replace(/[.-]/g, "_").replace(/[^a-zA-Z0-9_]/g, "_");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
