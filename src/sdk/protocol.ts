export type JSONRPCID = string | number;

export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: JSONRPCID;
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse<T = unknown> {
  jsonrpc: "2.0";
  id: JSONRPCID;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export interface JSONRPCNotification<T = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: T;
}

export interface InitializeResult {
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
  capabilities: string[];
}

export interface CreateSessionResult {
  sessionId: string;
  cwd: string;
}

export interface RunResult {
  sessionId: string;
  status: string;
}

export interface RunOptions {
  disableCompaction?: boolean;
  forceCompaction?: boolean;
  compactThresholdTokens?: number;
}

export interface CoreStreamDelta {
  content: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    index: number;
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  finish_reason?: string;
}

export type CoreEvent =
  | { sessionId: string; type: "turn_start"; turn?: number }
  | { sessionId: string; type: "turn_end" }
  | { sessionId: string; type: "stream"; delta: CoreStreamDelta }
  | { sessionId: string; type: "tool_started"; id?: string; name: string; message?: string }
  | { sessionId: string; type: "tool_finished"; id?: string; name: string; message?: string }
  | { sessionId: string; type: "tool_failed"; id?: string; name: string; message?: string; error?: string }
  | { sessionId: string; type: "plan_written"; id?: string; name: string; message?: string }
  | { sessionId: string; type: "subagent_started"; goal: string; agent_type?: string }
  | { sessionId: string; type: "subagent_stream"; delta: CoreStreamDelta }
  | { sessionId: string; type: "subagent_finished"; status: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }
  | { sessionId: string; type: "subagent_tool_started"; id?: string; name: string; message?: string }
  | { sessionId: string; type: "subagent_tool_finished"; id?: string; name: string; message?: string }
  | { sessionId: string; type: "subagent_tool_failed"; id?: string; name: string; message?: string; error?: string }
  | { sessionId: string; type: "subagent_plan_written"; id?: string; name: string; message?: string }
  | { sessionId: string; type: "compaction_started" }
  | { sessionId: string; type: "compaction_finished"; replaced_count?: number; summary_id?: string }
  | { sessionId: string; type: "compaction_failed"; error?: string }
  | { sessionId: string; type: "done"; content: string; exit_code?: number; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }
  | { sessionId: string; type: "error"; message: string; exit_code?: number }
  | { sessionId: string; type: "cancelled"; exit_code?: number };

export interface SessionMeta {
  id: string;
  title: string;
  created_at: string;
  last_updated: string;
  history_path: string;
  last_user_prompt: string;
  message_count: number;
}

export interface WorktreeInfo {
  Path: string;
  Branch: string;
  IsDetached: boolean;
  Status: string;
}

export interface ResolvedEndpoint {
  baseURL: string;
  model?: string;
  hasApiKey: boolean;
}

export interface CoreConfig {
  enabledTools: Record<string, boolean>;
  openai: ResolvedEndpoint;
  subagent: ResolvedEndpoint;
  skillsDir?: string;
}

export interface MCPServerInfo {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

export interface CoreToolInfo {
  name: string;
  description: string;
  parameters: unknown;
}

export interface CorePermissions {
  tools: Record<string, boolean>;
  commands: Record<string, Record<string, boolean>>;
}

export interface SessionInspectResult {
  meta: SessionMeta;
  audit: {
    path: string;
    messages: number;
    user_messages: number;
    assistant_messages: number;
    tool_result_messages: number;
    tool_calls: number;
    tool_names: string[];
    compaction_boundaries: number;
    compactions: Array<{ summary_id: string; replaced_ids: string[]; replaced_count: number }>;
  };
}

export type PermissionScope = "session" | "project" | "global";

export type ApprovalScope = PermissionScope | "once";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  kind: "command";
  command: string;
  reason?: string;
  needsApproval?: boolean;
  suggestedScope?: ApprovalScope;
  scopes?: ApprovalScope[];
  allowed?: Record<string, Record<string, boolean>>;
}

export interface ApprovalResponse {
  approved: boolean;
  scope?: ApprovalScope;
}
