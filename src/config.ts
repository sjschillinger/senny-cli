import { promises as fs } from "node:fs";
import path from "node:path";
import { configHome, ensureDir } from "./util.js";
import type { SennyConfig } from "./types.js";

const defaults: SennyConfig = {
  openAIBaseURL: "http://localhost:8080",
  openAIAPIKey: "",
  openAIModel: "",
  subagentBaseURL: "",
  subagentAPIKey: "",
  subagentModel: "",
  enabledTools: {
    read_file: true,
    write_file: true,
    target_edit: true,
    bash: true,
    spawn_subagent: true
  },
  maxTurns: 200,
  compactAfterTokens: 24000,
  approvalMode: "ask",
  mcpServers: {}
};

export async function loadConfig(cwd = process.cwd()): Promise<SennyConfig> {
  const dir = configHome();
  const file = path.join(dir, "config.json");
  await ensureDir(dir);

  let fromFile: Partial<SennyConfig> = {};
  try {
    fromFile = JSON.parse(await fs.readFile(file, "utf8")) as Partial<SennyConfig>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    await fs.writeFile(file, JSON.stringify(defaults, null, 2), { mode: 0o600 });
  }

  const lateMCP = await loadLateMCPConfig(cwd);
  const merged: SennyConfig = {
    ...defaults,
    ...fromFile,
    enabledTools: { ...defaults.enabledTools, ...(fromFile.enabledTools ?? {}) },
    mcpServers: { ...defaults.mcpServers, ...lateMCP, ...(fromFile.mcpServers ?? {}) }
  };

  merged.openAIBaseURL = process.env.OPENAI_BASE_URL || merged.openAIBaseURL;
  merged.openAIAPIKey = process.env.OPENAI_API_KEY || merged.openAIAPIKey;
  merged.openAIModel = process.env.OPENAI_MODEL || merged.openAIModel;
  merged.subagentBaseURL = process.env.SENNY_SUBAGENT_BASE_URL || merged.subagentBaseURL || merged.openAIBaseURL;
  merged.subagentAPIKey = process.env.SENNY_SUBAGENT_API_KEY || merged.subagentAPIKey || merged.openAIAPIKey;
  merged.subagentModel = process.env.SENNY_SUBAGENT_MODEL || merged.subagentModel || merged.openAIModel;

  validateConfig(merged);
  return merged;
}

export async function loadLateMCPConfig(cwd: string): Promise<SennyConfig["mcpServers"]> {
  const candidates = [
    path.join(cwd, ".senny", "mcp_config.json"),
    path.join(cwd, ".late", "mcp_config.json"),
    path.join(configHome(), "mcp_config.json")
  ];
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8")) as { mcpServers?: SennyConfig["mcpServers"] };
      const servers = parsed.mcpServers ?? {};
      for (const server of Object.values(servers)) {
        server.command = expandEnvVars(server.command);
        server.args = server.args?.map(expandEnvVars);
        if (server.env) {
          server.env = Object.fromEntries(Object.entries(server.env).map(([key, value]) => [key, expandEnvVars(value)]));
        }
      }
      return servers;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return {};
}

export function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? "");
}

export function validateConfig(config: SennyConfig): void {
  if (!config.openAIBaseURL) throw new Error("openAIBaseURL is required");
  if (!Number.isFinite(config.maxTurns) || config.maxTurns < 1) throw new Error("maxTurns must be a positive number");
  if (!Number.isFinite(config.compactAfterTokens) || config.compactAfterTokens < 1000) {
    throw new Error("compactAfterTokens must be at least 1000");
  }
  if (!["ask", "auto", "deny"].includes(config.approvalMode)) throw new Error("approvalMode must be ask, auto, or deny");
  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (!server || typeof server.command !== "string" || server.command.length === 0) {
      throw new Error(`mcpServers.${name}.command is required`);
    }
    if (server.args !== undefined && !Array.isArray(server.args)) throw new Error(`mcpServers.${name}.args must be an array`);
  }
}
