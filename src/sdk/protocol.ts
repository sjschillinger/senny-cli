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

export interface CoreEvent {
  sessionId: string;
  type: string;
  [key: string]: unknown;
}

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
