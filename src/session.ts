import path from "node:path";
import { promises as fs } from "node:fs";
import type { ChatMessage, SessionMeta, StreamDelta, ToolCall, Usage } from "./types.js";
import type { OpenAICompatClient } from "./client.js";
import type { ToolRegistry } from "./tools/registry.js";
import { atomicWrite, dataHome, ensureDir, estimateTokens } from "./util.js";
import { buildMemoryContext } from "./memory.js";
import { compactHistory } from "./compact.js";

export class Session {
  readonly id: string;
  readonly historyPath: string;
  history: ChatMessage[];
  compactionNote = "";
  private readonly createdAt: string;

  constructor(
    readonly client: OpenAICompatClient,
    readonly registry: ToolRegistry,
    readonly cwd: string,
    readonly systemPrompt: string,
    readonly compactAfterTokens: number,
    history: ChatMessage[] = [],
    id = new Date().toISOString().replace(/[:.]/g, "-")
  ) {
    this.id = id;
    this.history = history;
    this.historyPath = path.join(dataHome(), "sessions", `${id}.json`);
    this.createdAt = new Date().toISOString();
  }

  static async load(
    client: OpenAICompatClient,
    registry: ToolRegistry,
    cwd: string,
    systemPrompt: string,
    compactAfterTokens: number,
    id?: string
  ): Promise<Session> {
    if (!id) return new Session(client, registry, cwd, systemPrompt, compactAfterTokens);
    const historyPath = path.join(dataHome(), "sessions", `${id}.json`);
    const raw = await fs.readFile(historyPath, "utf8");
    return new Session(client, registry, cwd, systemPrompt, compactAfterTokens, JSON.parse(raw) as ChatMessage[], id);
  }

  async add(message: ChatMessage): Promise<void> {
    this.history.push(message);
    await this.save();
  }

  async save(): Promise<void> {
    await ensureDir(path.dirname(this.historyPath));
    await atomicWrite(this.historyPath, JSON.stringify(this.history, null, 2));
    await saveSessionMeta(this.meta());
  }

  meta(): SessionMeta {
    const firstUser = this.history.find((msg) => msg.role === "user")?.content ?? "Untitled Session";
    const lastUser = [...this.history].reverse().find((msg) => msg.role === "user")?.content ?? "";
    const now = new Date().toISOString();
    return {
      id: this.id,
      title: truncateRunes(firstUser.replace(/\s+/g, " "), 100),
      created_at: this.createdAt,
      last_updated: now,
      history_path: this.historyPath,
      message_count: this.history.length,
      last_user_prompt: truncateRunes(lastUser.replace(/\s+/g, " "), 100)
    };
  }

  async messagesForModel(): Promise<ChatMessage[]> {
    const memory = await buildMemoryContext(this.cwd);
    const systemBlocks = [this.systemPrompt, memory, this.compactionNote].filter(Boolean);
    let body = this.history;
    const tokenEstimate = estimateTokens(systemBlocks.join("\n\n")) + this.history.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    if (tokenEstimate > this.compactAfterTokens) {
      const compacted = compactHistory(this.history);
      this.compactionNote = compacted.note;
      body = compacted.history;
    }
    return [{ role: "system", content: systemBlocks.join("\n\n") }, ...body];
  }

  async *stream(signal?: AbortSignal): AsyncGenerator<StreamDelta> {
    yield* this.client.streamChat({ messages: await this.messagesForModel(), tools: this.registry.definitions() }, signal);
  }

  async addAssistant(content: string, reasoning: string, toolCalls: ToolCall[]): Promise<void> {
    await this.add({
      role: "assistant",
      content,
      reasoning_content: reasoning || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    });
  }

  async addToolResult(id: string, content: string): Promise<void> {
    await this.add({ role: "tool", tool_call_id: id, content });
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  const dir = path.join(dataHome(), "sessions");
  try {
    const names = await fs.readdir(dir);
    const metas = await Promise.all(
      names
        .filter((name) => name.endsWith(".meta.json"))
        .map(async (name) => JSON.parse(await fs.readFile(path.join(dir, name), "utf8")) as SessionMeta)
    );
    return metas.sort((a, b) => a.last_updated.localeCompare(b.last_updated));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function deleteSession(id: string): Promise<boolean> {
  const resolved = await resolveSessionID(id);
  if (!resolved) return false;
  const dir = path.join(dataHome(), "sessions");
  await Promise.allSettled([fs.rm(path.join(dir, `${resolved}.json`)), fs.rm(path.join(dir, `${resolved}.meta.json`))]);
  return true;
}

export async function resolveSessionID(prefix: string): Promise<string | undefined> {
  const sessions = await listSessions();
  const exact = sessions.find((session) => session.id === prefix);
  if (exact) return exact.id;
  const matches = sessions.filter((session) => session.id.startsWith(prefix));
  if (matches.length > 1) throw new Error(`session ID "${prefix}" is ambiguous, matches: ${matches.map((match) => match.id).join(", ")}`);
  return matches[0]?.id;
}

export function formatSessionDisplay(meta: SessionMeta, verbose = false): string {
  if (verbose) {
    return [
      `ID: ${meta.id}`,
      `    Title:   ${meta.title || "Untitled Session"}`,
      `    Created: ${formatDate(meta.created_at, true)}`,
      `    Updated: ${formatDate(meta.last_updated, true)}`,
      `    Msg #:   ${meta.message_count}`,
      meta.last_user_prompt ? `    Last:    ${truncateRunes(meta.last_user_prompt, 50)}` : ""
    ].filter(Boolean).join("\n").trim();
  }
  return `${meta.id}\t${truncateRunes(meta.title || "Untitled Session", 40)}\t${formatDate(meta.last_updated, false)}\t${meta.message_count}`.trim();
}

export function formatResumePrompt(binary = "senny"): string {
  return `To resume, use: ${binary} session load <id>`;
}

async function saveSessionMeta(meta: SessionMeta): Promise<void> {
  const file = path.join(dataHome(), "sessions", `${meta.id}.meta.json`);
  await atomicWrite(file, JSON.stringify(meta, null, 2));
}

function truncateRunes(value: string, max: number): string {
  const runes = [...value];
  return runes.length <= max ? value : `${runes.slice(0, max).join("")}...`;
}

function formatDate(value: string, withSeconds: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num: number) => String(num).padStart(2, "0");
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base;
}

export interface Accumulator {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage?: Usage;
  finishReason?: string;
}

export function appendDelta(acc: Accumulator, delta: StreamDelta): void {
  acc.content += delta.content;
  acc.reasoning += delta.reasoning;
  if (delta.usage?.total_tokens) acc.usage = delta.usage;
  if (delta.finishReason) acc.finishReason = delta.finishReason;
  for (const call of delta.toolCalls) {
    const index = call.index ?? acc.toolCalls.length;
    const existing = acc.toolCalls[index];
    if (existing) {
      existing.id = call.id || existing.id;
      existing.function.name = call.function.name || existing.function.name;
      existing.function.arguments += call.function.arguments || "";
    } else {
      acc.toolCalls[index] = call;
    }
  }
}
