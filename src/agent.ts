import { OpenAICompatClient } from "./client.js";
import { appendDelta, Session } from "./session.js";
import { ToolRegistry } from "./tools/registry.js";
import { defaultTools } from "./tools/core.js";
import { summarizeToolUse, type ToolUseRecord } from "./summaries.js";
import { subagentPrompt } from "./prompts.js";
import type { AgentEvent, SennyConfig, Tool, ToolCall } from "./types.js";

export interface AgentOptions {
  cwd: string;
  config: SennyConfig;
  unsafe: boolean;
  maxTurns?: number;
  onText?: (text: string) => void;
  onEvent?: (event: AgentEvent) => void;
  approveTool?: (tool: Tool, args: unknown) => Promise<boolean>;
  session?: Session;
  registry?: ToolRegistry;
}

export class Agent {
  readonly registry: ToolRegistry;
  readonly session: Session;

  constructor(
    readonly client: OpenAICompatClient,
    readonly systemPrompt: string,
    readonly options: AgentOptions
  ) {
    this.registry = options.session?.registry ?? options.registry ?? new ToolRegistry();
    for (const tool of defaultTools(options.config.enabledTools)) {
      this.registry.register(tool);
    }
    if (options.config.enabledTools.spawn_subagent !== false) {
      this.registry.register(this.spawnSubagentTool());
    }
    this.session = options.session ?? new Session(client, this.registry, options.cwd, systemPrompt, options.config.compactAfterTokens);
  }

  async run(input: string, signal?: AbortSignal): Promise<string> {
    await this.session.add({ role: "user", content: input });
    let lastContent = "";
    const maxTurns = this.options.maxTurns ?? this.options.config.maxTurns;

    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (signal?.aborted) {
        this.options.onEvent?.({ type: "cancelled" });
        return `${lastContent}\n\n(Cancelled)`;
      }
      this.options.onEvent?.({ type: "turn_start", turn: turn + 1 });
      const acc = { content: "", reasoning: "", toolCalls: [] as ToolCall[] };
      for await (const delta of this.session.stream(signal)) {
        appendDelta(acc, delta);
        if (delta.content) this.options.onText?.(delta.content);
      }

      await this.session.addAssistant(acc.content, acc.reasoning, acc.toolCalls.filter(Boolean));
      lastContent = acc.content;
      this.options.onEvent?.({ type: "assistant_done", content: acc.content, toolCalls: acc.toolCalls.filter(Boolean).length });

      if (acc.toolCalls.length === 0) {
        this.options.onEvent?.({ type: "done", content: lastContent });
        return lastContent;
      }

      const records = await this.executeToolCalls(acc.toolCalls.filter(Boolean), signal);
      const repair = this.repairInstruction(records);
      const summary = summarizeToolUse(records);
      if (summary) {
        await this.session.add({ role: "assistant", content: summary });
        this.options.onEvent?.({ type: "summary", content: summary });
      }
      if (repair) {
        await this.session.add({ role: "user", content: repair });
        this.options.onEvent?.({ type: "retry", reason: repair });
      }
    }

    const result = `${lastContent}\n\n(Terminated after reaching the max turn limit.)`;
    this.options.onEvent?.({ type: "done", content: result });
    return result;
  }

  private async executeToolCalls(calls: ToolCall[], signal?: AbortSignal): Promise<ToolUseRecord[]> {
    const records: ToolUseRecord[] = [];
    for (const call of calls) {
      const tool = this.registry.get(call.function.name);
      let args: unknown = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        const result = `Invalid JSON arguments for ${call.function.name}`;
        await this.session.addToolResult(call.id, result);
        records.push({ call, args: {}, result, tool });
        continue;
      }

      if (signal?.aborted) {
        this.options.onEvent?.({ type: "cancelled" });
        return records;
      }
      this.options.onEvent?.({ type: "tool_start", name: call.function.name, args });
      const result = await this.runTool(tool, args, call.function.name, signal);
      this.options.onEvent?.({ type: "tool_end", name: call.function.name, result });
      await this.session.addToolResult(call.id, result);
      records.push({ call, args, result, tool });
    }
    return records;
  }

  private repairInstruction(records: ToolUseRecord[]): string {
    const invalidJSON = records.filter((record) => record.result.startsWith("Invalid JSON arguments"));
    if (invalidJSON.length > 0) {
      return "One or more tool calls had invalid JSON arguments. Retry the tool call with strictly valid JSON only; do not explain before calling the corrected tool.";
    }
    const missingTools = records.filter((record) => record.result.startsWith("Error: tool not found"));
    if (missingTools.length > 0) {
      return "A requested tool is not available. Use the listed available tools instead and continue with the task.";
    }
    const editFailures = records.filter((record) => record.result.startsWith("Edit failed:"));
    if (editFailures.length > 0) {
      return "An exact edit failed. Re-read the target file, choose a unique current search block, and retry the edit once.";
    }
    return "";
  }

  private async runTool(tool: Tool | undefined, args: unknown, name: string, signal?: AbortSignal): Promise<string> {
    if (!tool) return `Error: tool not found: ${name}`;
    const needsApproval = tool.requiresApproval ? tool.requiresApproval(args) : tool.mutates;
    if (needsApproval && !this.options.unsafe) {
      const approved = await this.options.approveTool?.(tool, args);
      if (!approved) {
        this.options.onEvent?.({ type: "tool_denied", name: tool.name });
        return `Tool ${tool.name} was not approved and did not run.`;
      }
    }
    try {
      return await tool.run(args, { cwd: this.options.cwd, unsafe: this.options.unsafe, signal });
    } catch (err) {
      return `Error executing ${tool.name}: ${(err as Error).message}`;
    }
  }

  private spawnSubagentTool(): Tool {
    return {
      name: "spawn_subagent",
      description: "Run a scoped helper agent with a fresh context for one bounded task.",
      mutates: false,
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string" },
          context: { type: "string" }
        },
        required: ["goal"]
      },
      run: async (raw) => {
        const args = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
        const goal = String(args.goal ?? "");
        const context = String(args.context ?? "");
        if (!goal) throw new Error("spawn_subagent requires a goal");
        const subClient = new OpenAICompatClient({
          baseURL: this.options.config.subagentBaseURL,
          apiKey: this.options.config.subagentAPIKey,
          model: this.options.config.subagentModel
        });
        const sub = new Agent(subClient, subagentPrompt(), {
          ...this.options,
          config: { ...this.options.config, enabledTools: { ...this.options.config.enabledTools, spawn_subagent: false } },
          maxTurns: Math.min(40, this.options.config.maxTurns),
          onText: undefined
        });
        const handoff = [
          `Subagent goal:\n${goal}`,
          context ? `Relevant context:\n${context}` : "",
          "Return a concise completion report with files touched, tests run, and blockers."
        ].filter(Boolean).join("\n\n");
        return await sub.run(handoff);
      },
      summarize: (args) => `spawned subagent for ${String((args as Record<string, unknown>).goal ?? "")}`
    };
  }
}
