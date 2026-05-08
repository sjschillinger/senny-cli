export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  index?: number;
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: JsonSchema;
  };
}

export type JsonSchema = Record<string, unknown>;

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatCompletionChunk {
  choices?: Array<{
    delta?: Partial<ChatMessage>;
    finish_reason?: string | null;
  }>;
  usage?: Usage;
}

export interface StreamDelta {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage?: Usage;
  finishReason?: string;
}

export interface ToolContext {
  cwd: string;
  unsafe: boolean;
  signal?: AbortSignal;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  mutates: boolean;
  requiresApproval?(args: unknown): boolean;
  run(args: unknown, ctx: ToolContext): Promise<string>;
  summarize?(args: unknown, result: string): string;
}

export interface SennyConfig {
  openAIBaseURL: string;
  openAIAPIKey: string;
  openAIModel: string;
  subagentBaseURL: string;
  subagentAPIKey: string;
  subagentModel: string;
  enabledTools: Record<string, boolean>;
  maxTurns: number;
  compactAfterTokens: number;
  approvalMode: "ask" | "auto" | "deny";
  mcpServers: Record<string, MCPServerConfig>;
}

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
}

export type AgentEvent =
  | { type: "turn_start"; turn: number }
  | { type: "assistant_done"; content: string; toolCalls: number }
  | { type: "tool_start"; name: string; args: unknown }
  | { type: "tool_end"; name: string; result: string }
  | { type: "tool_denied"; name: string }
  | { type: "summary"; content: string }
  | { type: "retry"; reason: string }
  | { type: "cancelled" }
  | { type: "done"; content: string };

export interface SessionMeta {
  id: string;
  title: string;
  created_at: string;
  last_updated: string;
  history_path: string;
  message_count: number;
  last_user_prompt: string;
}
