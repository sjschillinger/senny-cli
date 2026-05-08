import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CoreEvent,
  CreateSessionResult,
  InitializeResult,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  MCPServerInfo,
  PermissionScope,
  CoreConfig,
  RunResult,
  SessionMeta,
  CorePermissions,
  CoreToolInfo,
  WorktreeInfo
} from "./protocol.js";

export interface SennyCoreOptions {
  command?: string;
  args?: string[];
  cwd?: string;
}

export class SennyCoreClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private nextID = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  private ready?: Promise<void>;

  static async start(options: SennyCoreOptions = {}): Promise<SennyCoreClient> {
    const client = new SennyCoreClient(options);
    await client.start();
    await client.initialize();
    return client;
  }

  private constructor(private readonly options: SennyCoreOptions) {
    super();
  }

  async start(): Promise<void> {
    const bundled = bundledCorePath();
    const command = this.options.command ?? bundled.command;
    const args = this.options.args ?? bundled.args;
    const cwd = this.options.args || this.options.command ? (this.options.cwd ?? process.cwd()) : bundled.cwd;
    this.child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stderr.on("data", (chunk) => this.emit("stderr", chunk.toString("utf8")));
    this.child.on("exit", (code, signal) => this.emit("exit", { code, signal }));
    this.ready = new Promise((resolve, reject) => {
      this.child!.once("spawn", resolve);
      this.child!.once("error", reject);
    });

    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => this.handleLine(line));
    await this.ready;
  }

  async initialize(): Promise<InitializeResult> {
    return await this.request<InitializeResult>("initialize", {
      protocolVersion: "2026-05-08",
      clientName: "senny-sdk",
      clientVersion: "0.1.0"
    });
  }

  async createSession(params: { cwd: string; model?: string; resume?: string }): Promise<CoreSession> {
    const result = await this.request<CreateSessionResult>("session/create", params);
    return new CoreSession(this, result.sessionId, result.cwd);
  }

  async getConfig(): Promise<CoreConfig> {
    return await this.request<CoreConfig>("config/get", {});
  }

  async listMCP(cwd = process.cwd()): Promise<MCPServerInfo[]> {
    return await this.request<MCPServerInfo[]>("mcp/list", { cwd });
  }

  async listTools(params: { cwd?: string; planning?: boolean } = {}): Promise<CoreToolInfo[]> {
    return await this.request<CoreToolInfo[]>("tools/list", params);
  }

  async listPermissions(cwd = process.cwd()): Promise<CorePermissions> {
    return await this.request<CorePermissions>("permissions/list", { cwd });
  }

  async allowTool(name: string, scope: PermissionScope = "project", cwd = process.cwd()): Promise<boolean> {
    const result = await this.request<{ allowed: boolean }>("permissions/allowTool", { cwd, name, scope });
    return result.allowed;
  }

  async allowCommand(command: string, scope: PermissionScope = "project", cwd = process.cwd()): Promise<boolean> {
    const result = await this.request<{ allowed: boolean }>("permissions/allowCommand", { cwd, command, scope });
    return result.allowed;
  }

  async listSessions(): Promise<SessionMeta[]> {
    return await this.request<SessionMeta[]>("session/list", {});
  }

  async deleteSession(id: string): Promise<boolean> {
    const result = await this.request<{ deleted: boolean }>("session/delete", { id });
    return result.deleted;
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    return await this.request<WorktreeInfo[]>("worktree/list", {});
  }

  async activeWorktree(): Promise<string> {
    const result = await this.request<{ path: string }>("worktree/active", {});
    return result.path;
  }

  async createWorktree(path: string, branch = ""): Promise<boolean> {
    const result = await this.request<{ created: boolean }>("worktree/create", { path, branch });
    return result.created;
  }

  async removeWorktree(path: string): Promise<boolean> {
    const result = await this.request<{ removed: boolean }>("worktree/remove", { path });
    return result.removed;
  }

  async shutdown(): Promise<void> {
    if (!this.child) return;
    await this.request("shutdown", {}).catch(() => undefined);
    this.child.stdin.end();
    this.child.kill();
    await new Promise<void>((resolve) => {
      if (!this.child || this.child.killed) return resolve();
      this.child.once("exit", () => resolve());
      setTimeout(resolve, 250).unref();
    });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.child) throw new Error("core process is not started");
    const id = this.nextID++;
    const req: JSONRPCRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.child!.stdin.write(`${JSON.stringify(req)}\n`);
    });
  }

  private handleLine(line: string): void {
    const msg = JSON.parse(line) as JSONRPCResponse | JSONRPCNotification;
    if ("id" in msg) {
      const pending = this.pending.get(Number(msg.id));
      if (!pending) return;
      this.pending.delete(Number(msg.id));
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
      return;
    }
    if (msg.method === "session/event") this.emit("event", msg.params as CoreEvent);
    this.emit("notification", msg);
  }
}

function bundledCorePath(): { command: string; args: string[]; cwd: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..", "..");
  const binary = path.join(root, "core-go", "bin", process.platform === "win32" ? "senny-core.exe" : "senny-core");
  return { command: binary, args: [], cwd: root };
}

export class CoreSession {
  constructor(
    private readonly client: SennyCoreClient,
    readonly id: string,
    readonly cwd: string
  ) {}

  async run(prompt: string): Promise<RunResult> {
    return await this.client.request<RunResult>("session/run", { sessionId: this.id, prompt });
  }

  async cancel(): Promise<boolean> {
    const result = await this.client.request<{ cancelled: boolean }>("session/cancel", { sessionId: this.id });
    return result.cancelled;
  }
}
