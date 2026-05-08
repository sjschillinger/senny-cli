package rpc

import "encoding/json"

type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *Error          `json:"error,omitempty"`
}

type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type Notification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type InitializeParams struct {
	ProtocolVersion string `json:"protocolVersion"`
	ClientName      string `json:"clientName"`
	ClientVersion   string `json:"clientVersion"`
}

type InitializeResult struct {
	ProtocolVersion string   `json:"protocolVersion"`
	ServerName      string   `json:"serverName"`
	ServerVersion   string   `json:"serverVersion"`
	Capabilities    []string `json:"capabilities"`
}

type CreateSessionParams struct {
	CWD    string `json:"cwd"`
	Model  string `json:"model,omitempty"`
	Resume string `json:"resume,omitempty"`
}

type CreateSessionResult struct {
	SessionID string `json:"sessionId"`
	CWD       string `json:"cwd"`
}

type RunParams struct {
	SessionID string `json:"sessionId"`
	Prompt    string `json:"prompt"`
}

type RunResult struct {
	SessionID string `json:"sessionId"`
	Status    string `json:"status"`
}

type CancelParams struct {
	SessionID string `json:"sessionId"`
}

type DeleteSessionParams struct {
	ID string `json:"id"`
}

type WorktreeCreateParams struct {
	Path   string `json:"path"`
	Branch string `json:"branch,omitempty"`
}

type WorktreePathParams struct {
	Path string `json:"path"`
}

type SessionMeta struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	CreatedAt      string `json:"created_at"`
	LastUpdated    string `json:"last_updated"`
	HistoryPath    string `json:"history_path"`
	LastUserPrompt string `json:"last_user_prompt"`
	MessageCount   int    `json:"message_count"`
}
