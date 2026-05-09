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
	SessionID              string `json:"sessionId"`
	Prompt                 string `json:"prompt"`
	DisableCompaction      bool   `json:"disableCompaction,omitempty"`
	ForceCompaction        bool   `json:"forceCompaction,omitempty"`
	CompactThresholdTokens int    `json:"compactThresholdTokens,omitempty"`
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

type InspectSessionParams struct {
	ID string `json:"id"`
}

type CWDParams struct {
	CWD string `json:"cwd,omitempty"`
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

type ResolvedEndpoint struct {
	BaseURL   string `json:"baseURL"`
	Model     string `json:"model,omitempty"`
	HasAPIKey bool   `json:"hasApiKey"`
}

type ConfigResult struct {
	EnabledTools map[string]bool  `json:"enabledTools"`
	OpenAI       ResolvedEndpoint `json:"openai"`
	Subagent     ResolvedEndpoint `json:"subagent"`
	SkillsDir    string           `json:"skillsDir,omitempty"`
}

type MCPServerInfo struct {
	Name     string            `json:"name"`
	Command  string            `json:"command"`
	Args     []string          `json:"args,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
	Disabled bool              `json:"disabled,omitempty"`
}

type ToolInfo struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type ToolsListParams struct {
	CWD      string `json:"cwd,omitempty"`
	Planning bool   `json:"planning,omitempty"`
}

type PermissionsResult struct {
	Tools    map[string]bool            `json:"tools"`
	Commands map[string]map[string]bool `json:"commands"`
}

type PermissionToolParams struct {
	CWD   string `json:"cwd,omitempty"`
	Name  string `json:"name"`
	Scope string `json:"scope,omitempty"`
}

type PermissionCommandParams struct {
	CWD     string `json:"cwd,omitempty"`
	Command string `json:"command"`
	Scope   string `json:"scope,omitempty"`
}

type ApprovalRequest struct {
	ID             string                     `json:"id"`
	SessionID      string                     `json:"sessionId"`
	Kind           string                     `json:"kind"`
	Command        string                     `json:"command"`
	Reason         string                     `json:"reason,omitempty"`
	NeedsApproval  bool                       `json:"needsApproval,omitempty"`
	SuggestedScope string                     `json:"suggestedScope,omitempty"`
	Scopes         []string                   `json:"scopes,omitempty"`
	Allowed        map[string]map[string]bool `json:"allowed,omitempty"`
}

type ApprovalRespondParams struct {
	ID       string `json:"id"`
	Approved bool   `json:"approved"`
	Scope    string `json:"scope,omitempty"`
}
