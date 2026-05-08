#!/usr/bin/env node
import path from "node:path";
import { loadConfig } from "./config.js";
import { OpenAICompatClient } from "./client.js";
import { Agent } from "./agent.js";
import { architectPrompt } from "./prompts.js";
import { approveInTerminal, runInteractive } from "./interactive.js";
import { deleteSession, formatResumePrompt, formatSessionDisplay, listSessions, resolveSessionID, Session } from "./session.js";
import { activeWorktree, createWorktree, listWorktrees, removeWorktree } from "./worktree.js";
import { ToolRegistry } from "./tools/registry.js";
import { MCPManager } from "./mcp.js";
import { defaultSkillDirs, discoverSkills, registerActivateSkillTool } from "./skills.js";
import { SennyCoreClient } from "./sdk/index.js";

let lastMCPManager: MCPManager | undefined;

interface Args {
  command: string;
  rest: string[];
  prompt: string;
  cwd: string;
  unsafe: boolean;
  yes: boolean;
  core: boolean;
  ts: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { command: "", rest: [], prompt: "", cwd: process.cwd(), unsafe: false, yes: false, core: false, ts: false, help: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--unsafe") out.unsafe = true;
    else if (arg === "--core") out.core = true;
    else if (arg === "--ts") out.ts = true;
    else if (arg === "-y" || arg === "--yes") out.yes = true;
    else if (arg === "--cwd") out.cwd = path.resolve(argv[++i] ?? out.cwd);
    else rest.push(arg);
  }
  out.command = rest[0] ?? "";
  out.rest = rest.slice(1);
  out.prompt = rest.join(" ").trim();
  return out;
}

function printHelp(): void {
  console.log(`Usage:
  senny [flags]                      Start interactive mode
  senny [flags] "<prompt>"            Run one prompt
  senny session list                  List saved sessions
  senny session load <id-prefix>       Resume a session interactively
  senny session delete <id-prefix>     Delete a session
  senny worktree list                  List git worktrees
  senny worktree create <path> [ref]   Create a worktree
  senny worktree remove <path>         Remove a worktree
  senny worktree active                Show active worktree
  senny mcp list                       List configured MCP tools
  senny core config                    Show native core config
  senny core mcp                       Show native core MCP servers
  senny core tools [--planning]         Show native core tools
  senny core permissions               Show native core approvals
  senny core allow-tool <name> [scope]  Approve a native core tool
  senny core allow-command <cmd> [scope] Approve a native core command

Flags:
  --cwd <path>   Project root to operate in
  --unsafe       Allow mutating tools without prompting
  -y, --yes      Approve mutating tools when prompted by the agent
  --core         Route one-shot prompt through native Go core
  --ts           Route one-shot prompt through TypeScript prototype
  --help         Show help

Environment:
  OPENAI_BASE_URL   OpenAI-compatible endpoint (default: http://localhost:8080)
  OPENAI_API_KEY    Optional API key
  OPENAI_MODEL      Optional model name
`);
}

async function makeAgent(args: Args, sessionID?: string): Promise<Agent> {
  const config = await loadConfig(args.cwd);
  const client = new OpenAICompatClient({
    baseURL: config.openAIBaseURL,
    apiKey: config.openAIAPIKey,
    model: config.openAIModel
  });
  const registry = new ToolRegistry();
  registerActivateSkillTool(registry, await discoverSkills(defaultSkillDirs(args.cwd)));
  const session = sessionID
    ? await Session.load(client, registry, args.cwd, architectPrompt, config.compactAfterTokens, sessionID)
    : undefined;
  const mcp = new MCPManager();
  await mcp.connectConfigured(config, registry, args.cwd);
  lastMCPManager = mcp;
  const agent = new Agent(client, architectPrompt, {
    cwd: args.cwd,
    config,
    unsafe: args.unsafe || config.approvalMode === "auto",
    approveTool: args.yes || config.approvalMode === "auto"
      ? async () => true
      : config.approvalMode === "deny"
        ? async () => false
        : (tool, toolArgs) => approveInTerminal(tool, toolArgs, args.cwd),
    registry,
    session,
    onText: (text) => process.stdout.write(text),
    onEvent: (event) => {
      if (event.type === "turn_start") console.error(`\n[turn ${event.turn}]`);
      else if (event.type === "tool_start") console.error(`\n[tool] ${event.name}`);
      else if (event.type === "tool_denied") console.error(`[denied] ${event.name}`);
      else if (event.type === "retry") console.error(`[retry] ${event.reason}`);
      else if (event.type === "cancelled") console.error("[cancelled]");
    }
  });
  process.once("exit", () => {
    void mcp.close();
  });
  return agent;
}

async function handleSession(args: Args): Promise<boolean> {
  if (args.command !== "session") return false;
  const sub = args.rest[0] ?? "";
  if (sub === "list") {
    const sessions = await listSessions();
    if (sessions.length === 0) {
      console.log("No saved sessions.");
      return true;
    }
    for (const session of sessions) console.log(formatSessionDisplay(session, args.rest.includes("-v")));
    console.log(formatResumePrompt("senny"));
    return true;
  }
  if (sub === "load") {
    const id = await resolveSessionID(args.rest[1] ?? "");
    if (!id) throw new Error(`session not found: ${args.rest[1] ?? ""}`);
    const agent = await makeAgent(args, id);
    await runInteractive(agent);
    console.error(`Session saved to ${agent.session.historyPath}`);
    return true;
  }
  if (sub === "delete") {
    const ok = await deleteSession(args.rest[1] ?? "");
    if (!ok) throw new Error(`session not found: ${args.rest[1] ?? ""}`);
    console.log("Deleted session.");
    return true;
  }
  printHelp();
  return true;
}

async function handleWorktree(args: Args): Promise<boolean> {
  if (args.command !== "worktree") return false;
  const sub = args.rest[0] ?? "";
  if (sub === "list") console.log(await listWorktrees(args.cwd));
  else if (sub === "active") console.log(await activeWorktree(args.cwd));
  else if (sub === "create") {
    if (!args.rest[1]) throw new Error("worktree create requires a path");
    console.log(await createWorktree(args.cwd, args.rest[1], args.rest[2]));
  } else if (sub === "remove") {
    if (!args.rest[1]) throw new Error("worktree remove requires a path");
    console.log(await removeWorktree(args.cwd, args.rest[1]));
  }
  else printHelp();
  return true;
}

async function handleMCP(args: Args): Promise<boolean> {
  if (args.command !== "mcp") return false;
  if ((args.rest[0] ?? "") !== "list") {
    printHelp();
    return true;
  }
  await makeAgent(args);
  const mcp = lastMCPManager;
  if (!mcp) return true;
  for (const err of mcp.errors) console.log(`error: ${err}`);
  if (mcp.tools.length === 0) {
    console.log("No MCP tools registered.");
    return true;
  }
  for (const tool of mcp.tools) console.log(`${tool.registeredName}  ${tool.description}`);
  return true;
}

async function withCore<T>(args: Args, fn: (client: SennyCoreClient) => Promise<T>): Promise<T> {
  const client = await SennyCoreClient.start({ cwd: args.cwd });
  try {
    return await fn(client);
  } finally {
    await client.shutdown();
  }
}

function printJSON(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function handleCore(args: Args): Promise<boolean> {
  if (args.command !== "core") return false;
  const sub = args.rest[0] ?? "";
  if (sub === "config") {
    await withCore(args, async (client) => printJSON(await client.getConfig()));
    return true;
  }
  if (sub === "mcp") {
    await withCore(args, async (client) => printJSON(await client.listMCP(args.cwd)));
    return true;
  }
  if (sub === "tools") {
    const planning = args.rest.includes("--planning");
    await withCore(args, async (client) => printJSON(await client.listTools({ cwd: args.cwd, planning })));
    return true;
  }
  if (sub === "permissions") {
    await withCore(args, async (client) => printJSON(await client.listPermissions(args.cwd)));
    return true;
  }
  if (sub === "allow-tool") {
    const name = args.rest[1];
    const scope = args.rest[2] ?? "project";
    if (!name) throw new Error("core allow-tool requires a tool name");
    if (!["session", "project", "global"].includes(scope)) throw new Error("scope must be session, project, or global");
    await withCore(args, async (client) => {
      await client.allowTool(name, scope as "session" | "project" | "global", args.cwd);
      console.log(`Approved tool ${name} for ${scope} scope.`);
    });
    return true;
  }
  if (sub === "allow-command") {
    const scopeCandidate = args.rest.at(-1) ?? "";
    const hasExplicitScope = ["session", "project", "global"].includes(scopeCandidate);
    const scope = hasExplicitScope ? scopeCandidate : "project";
    const commandParts = args.rest.slice(1, hasExplicitScope ? -1 : undefined);
    const command = commandParts.join(" ").trim();
    if (!command) throw new Error("core allow-command requires a command");
    await withCore(args, async (client) => {
      await client.allowCommand(command, scope as "session" | "project" | "global", args.cwd);
      console.log(`Approved command ${command} for ${scope} scope.`);
    });
    return true;
  }
  printHelp();
  return true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (await handleSession(args)) return;
  if (await handleWorktree(args)) return;
  if (await handleMCP(args)) return;
  if (await handleCore(args)) return;

  if (!args.prompt) {
    const agent = await makeAgent(args);
    await runInteractive(agent);
  } else if (args.core || !args.ts) {
    const client = await SennyCoreClient.start({ cwd: args.cwd });
    let finishCoreRun!: () => void;
    const coreDone = new Promise<void>((resolve) => {
      finishCoreRun = resolve;
    });
    client.on("event", (event) => {
      if (event.type === "done" && typeof event.content === "string") process.stdout.write(`${event.content}\n`);
      if (event.type === "done" || event.type === "error" || event.type === "cancelled") finishCoreRun();
      else console.error(`[core] ${event.type}`);
    });
    try {
      const session = await client.createSession({ cwd: args.cwd });
      await session.run(args.prompt);
      await coreDone;
    } finally {
      await client.shutdown();
    }
  } else {
    const agent = await makeAgent(args);
    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.once("SIGINT", onSigint);
    try {
      await agent.run(args.prompt, controller.signal);
    } finally {
      process.off("SIGINT", onSigint);
    }
    process.stdout.write("\n");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
