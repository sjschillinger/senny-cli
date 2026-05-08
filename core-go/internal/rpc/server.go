package rpc

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"senny/internal/assets"
	"senny/internal/client"
	"senny/internal/common"
	appconfig "senny/internal/config"
	"senny/internal/executor"
	"senny/internal/git"
	"senny/internal/mcp"
	sessionpkg "senny/internal/session"
	"senny/internal/tool"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Server struct {
	in  io.Reader
	out io.Writer

	mu       sync.Mutex
	cwdMu    sync.Mutex
	sessions map[string]*Session
}

type Session struct {
	ID        string
	CWD       string
	Model     string
	Title     string
	CreatedAt time.Time
	UpdatedAt time.Time
	Cancel    context.CancelFunc
	Late      *sessionpkg.Session
}

func NewServer(in io.Reader, out io.Writer) *Server {
	return &Server{in: in, out: out, sessions: make(map[string]*Session)}
}

func (s *Server) Serve(ctx context.Context) error {
	scanner := bufio.NewScanner(s.in)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		var req Request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			s.write(Response{JSONRPC: "2.0", Error: &Error{Code: -32700, Message: err.Error()}})
			continue
		}
		s.handle(ctx, req)
	}
	return scanner.Err()
}

func (s *Server) handle(ctx context.Context, req Request) {
	switch req.Method {
	case "initialize":
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: InitializeResult{
			ProtocolVersion: "2026-05-08",
			ServerName:      "senny-core",
			ServerVersion:   "0.1.0",
			Capabilities:    []string{"sessions", "run", "cancel", "events", "config", "mcp", "tools", "permissions"},
		}})
	case "config/get":
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: s.configResult()})
	case "mcp/list":
		var params CWDParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		result, err := s.listMCP(params.CWD)
		if err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: result})
	case "tools/list":
		var params ToolsListParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		result, err := s.listTools(params)
		if err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: result})
	case "permissions/list":
		var params CWDParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		result, err := s.listPermissions(params.CWD)
		if err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: result})
	case "permissions/allowTool":
		var params PermissionToolParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		if err := s.allowTool(params); err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: map[string]bool{"allowed": true}})
	case "permissions/allowCommand":
		var params PermissionCommandParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		if err := s.allowCommand(params); err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: map[string]bool{"allowed": true}})
	case "session/create":
		var params CreateSessionParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		session := s.createSession(params)
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: CreateSessionResult{SessionID: session.ID, CWD: session.CWD}})
	case "session/list":
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: s.listSessions()})
	case "session/delete":
		var params DeleteSessionParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		if err := deleteSavedSession(params.ID); err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: map[string]bool{"deleted": true}})
	case "session/run":
		var params RunParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		if err := s.run(ctx, params); err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: RunResult{SessionID: params.SessionID, Status: "started"}})
	case "session/cancel":
		var params CancelParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		cancelled := s.cancel(params.SessionID)
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: map[string]bool{"cancelled": cancelled}})
	case "shutdown":
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: map[string]string{"status": "ok"}})
	case "worktree/list":
		worktrees, err := git.ListWorktrees()
		if err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: worktrees})
	case "worktree/active":
		active, err := git.GetActiveWorktree()
		if err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: map[string]string{"path": active}})
	case "worktree/create":
		var params WorktreeCreateParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		if err := git.CreateWorktree(params.Path, params.Branch); err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: map[string]bool{"created": true}})
	case "worktree/remove":
		var params WorktreePathParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		if err := git.RemoveWorktree(params.Path); err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: map[string]bool{"removed": true}})
	default:
		s.writeErr(req.ID, -32601, fmt.Errorf("unknown method: %s", req.Method))
	}
}

func (s *Server) configResult() ConfigResult {
	cfg, _ := appconfig.LoadConfig()
	openAI := appconfig.ResolveOpenAISettings(cfg)
	subagent := appconfig.ResolveSubagentSettings(cfg, openAI)
	return ConfigResult{
		EnabledTools: cfg.EnabledTools,
		OpenAI: ResolvedEndpoint{
			BaseURL:   openAI.BaseURL,
			Model:     openAI.Model,
			HasAPIKey: openAI.APIKey != "",
		},
		Subagent: ResolvedEndpoint{
			BaseURL:   subagent.BaseURL,
			Model:     subagent.Model,
			HasAPIKey: subagent.APIKey != "",
		},
		SkillsDir: cfg.SkillsDir,
	}
}

func (s *Server) listMCP(cwd string) ([]MCPServerInfo, error) {
	var result []MCPServerInfo
	err := s.withCWD(cwd, func() error {
		cfg, err := mcp.LoadMCPConfig()
		if err != nil {
			return err
		}
		for name, server := range cfg.McpServers {
			mcp.ExpandServerEnvVars(&server)
			result = append(result, MCPServerInfo{
				Name:     name,
				Command:  server.Command,
				Args:     server.Args,
				Env:      server.Env,
				Disabled: server.Disabled,
			})
		}
		sort.Slice(result, func(i, j int) bool {
			return result[i].Name < result[j].Name
		})
		return nil
	})
	return result, err
}

func (s *Server) listTools(params ToolsListParams) ([]ToolInfo, error) {
	var result []ToolInfo
	err := s.withCWD(params.CWD, func() error {
		cfg, _ := appconfig.LoadConfig()
		reg := tool.NewRegistry()
		executor.RegisterTools(reg, cfg.EnabledTools, params.Planning)
		for _, t := range reg.All() {
			result = append(result, ToolInfo{Name: t.Name(), Description: t.Description(), Parameters: t.Parameters()})
		}
		return nil
	})
	return result, err
}

func (s *Server) listPermissions(cwd string) (PermissionsResult, error) {
	result := PermissionsResult{Tools: map[string]bool{}, Commands: map[string]map[string]bool{}}
	err := s.withCWD(cwd, func() error {
		tools, err := tool.LoadAllAllowedTools()
		if err != nil {
			return err
		}
		commands, err := tool.LoadAllAllowedCommands()
		if err != nil {
			return err
		}
		result.Tools = tools
		result.Commands = commands
		return nil
	})
	return result, err
}

func (s *Server) allowTool(params PermissionToolParams) error {
	if strings.TrimSpace(params.Name) == "" {
		return fmt.Errorf("name is required")
	}
	return s.withCWD(params.CWD, func() error {
		switch params.Scope {
		case "", "project":
			return tool.SaveAllowedTool(params.Name, false)
		case "global":
			return tool.SaveAllowedTool(params.Name, true)
		case "session":
			tool.SaveSessionAllowedTool(params.Name)
			return nil
		default:
			return fmt.Errorf("unknown permission scope: %s", params.Scope)
		}
	})
}

func (s *Server) allowCommand(params PermissionCommandParams) error {
	if strings.TrimSpace(params.Command) == "" {
		return fmt.Errorf("command is required")
	}
	return s.withCWD(params.CWD, func() error {
		switch params.Scope {
		case "", "project":
			return tool.SaveAllowedCommand(params.Command, false)
		case "global":
			return tool.SaveAllowedCommand(params.Command, true)
		case "session":
			tool.SaveSessionAllowedCommand(params.Command)
			return nil
		default:
			return fmt.Errorf("unknown permission scope: %s", params.Scope)
		}
	})
}

// withCWD temporarily changes the process working directory and serialises
// callers through cwdMu for the full duration of fn. Concurrent session/run
// goroutines will therefore execute sequentially. This is acceptable for the
// single-user CLI; a multi-session server should pass cwd explicitly through
// the call stack rather than relying on the process-global working directory.
func (s *Server) withCWD(cwd string, fn func() error) error {
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		return fn()
	}
	s.cwdMu.Lock()
	defer s.cwdMu.Unlock()
	old, err := os.Getwd()
	if err != nil {
		return err
	}
	if err := os.Chdir(cwd); err != nil {
		return err
	}
	defer func() {
		_ = os.Chdir(old)
	}()
	return fn()
}

func (s *Server) createSession(params CreateSessionParams) *Session {
	cwd := params.CWD
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	id := params.Resume
	if id == "" {
		id = "session-" + time.Now().Format("20060102-150405")
	}
	now := time.Now()
	session := &Session{ID: id, CWD: cwd, Model: params.Model, Title: "Untitled Session", CreatedAt: now, UpdatedAt: now}
	if params.Model != "__mock__" {
		session.Late = newLateSession(id, cwd, params.Model)
	}
	s.mu.Lock()
	s.sessions[id] = session
	s.mu.Unlock()
	return session
}

func (s *Server) listSessions() []SessionMeta {
	saved, err := sessionpkg.ListSessions()
	if err == nil && len(saved) > 0 {
		metas := make([]SessionMeta, 0, len(saved))
		for _, meta := range saved {
			metas = append(metas, SessionMeta{
				ID:             meta.ID,
				Title:          meta.Title,
				CreatedAt:      meta.CreatedAt.Format(time.RFC3339),
				LastUpdated:    meta.LastUpdated.Format(time.RFC3339),
				HistoryPath:    meta.HistoryPath,
				LastUserPrompt: meta.LastUserPrompt,
				MessageCount:   meta.MessageCount,
			})
		}
		return metas
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	metas := make([]SessionMeta, 0, len(s.sessions))
	for _, session := range s.sessions {
		metas = append(metas, SessionMeta{
			ID:           session.ID,
			Title:        session.Title,
			CreatedAt:    session.CreatedAt.Format(time.RFC3339),
			LastUpdated:  session.UpdatedAt.Format(time.RFC3339),
			HistoryPath:  filepath.Join(session.CWD, ".senny", "sessions", session.ID+".json"),
			MessageCount: 0,
		})
	}
	return metas
}

func deleteSavedSession(id string) error {
	meta, err := sessionpkg.LoadSessionMeta(id)
	if err != nil {
		return err
	}
	if meta == nil {
		return fmt.Errorf("session not found: %s", id)
	}
	if err := os.Remove(meta.HistoryPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Remove(filepath.Join(sessionDir(), meta.ID+".meta.json"))
}

func (s *Server) run(parent context.Context, params RunParams) error {
	s.mu.Lock()
	session := s.sessions[params.SessionID]
	if session == nil {
		s.mu.Unlock()
		return fmt.Errorf("session not found: %s", params.SessionID)
	}
	runCtx, cancel := context.WithCancel(parent)
	session.Cancel = cancel
	session.UpdatedAt = time.Now()
	if session.Title == "Untitled Session" && strings.TrimSpace(params.Prompt) != "" {
		session.Title = truncate(params.Prompt, 100)
	}
	s.mu.Unlock()

	go func() {
		s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "turn_start", "turn": 1})
		if session.Model != "__mock__" && session.Late != nil {
			err := s.withCWD(session.CWD, func() error {
				if err := session.Late.AddUserMessage(params.Prompt); err != nil {
					return err
				}
				res, err := executor.RunLoop(
					runCtx,
					session.Late,
					200,
					nil,
					func() {
						s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "turn_start"})
					},
					func() {
						s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "turn_end"})
					},
					func(result common.StreamResult) {
						s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "stream", "delta": result})
					},
					[]common.ToolMiddleware{shellApprovalMiddleware()},
				)
				if err != nil {
					return err
				}
				s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "done", "content": res})
				return nil
			})
			if err != nil {
				s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "error", "message": err.Error()})
				return
			}
			return
		}
		select {
		case <-runCtx.Done():
			s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "cancelled"})
		default:
			s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "done", "content": "native core skeleton ready"})
		}
	}()
	return nil
}

func newLateSession(id, cwd, model string) *sessionpkg.Session {
	cfg, _ := appconfig.LoadConfig()
	settings := appconfig.ResolveOpenAISettings(cfg)
	if model != "" {
		settings.Model = model
	}
	c := client.NewClient(client.Config{BaseURL: settings.BaseURL, APIKey: settings.APIKey, Model: settings.Model})
	c.DiscoverBackend(context.Background())
	promptBytes, _ := assets.PromptsFS.ReadFile("prompts/instruction-planning.md")
	systemPrompt := strings.ReplaceAll(string(promptBytes), "${{CWD}}", cwd)
	historyPath := filepath.Join(sessionDir(), id+".json")
	history, _ := sessionpkg.LoadHistory(historyPath)
	sess := sessionpkg.New(c, historyPath, history, systemPrompt, true)
	enabled := map[string]bool{"read_file": true, "bash": true, "write_file": true, "target_edit": true}
	executor.RegisterTools(sess.Registry, enabled, true)
	return sess
}

// shellApprovalMiddleware enforces the bash analyzer allow-list before tool execution.
// Blocked commands return an error string; commands needing confirmation return guidance.
func shellApprovalMiddleware() common.ToolMiddleware {
	return func(next common.ToolRunner) common.ToolRunner {
		return func(ctx context.Context, tc client.ToolCall) (string, error) {
			if tc.Function.Name != "bash" {
				return next(ctx, tc)
			}
			var args struct {
				Command string `json:"command"`
			}
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil || args.Command == "" {
				return next(ctx, tc)
			}
			allowed, _ := tool.LoadAllAllowedCommands()
			analyzer := &tool.BashAnalyzer{ProjectAllowedCommands: allowed}
			analysis := analyzer.Analyze(args.Command)
			if analysis.IsBlocked {
				reason := "Command blocked for safety."
				if analysis.BlockReason != nil {
					reason = analysis.BlockReason.Error()
				}
				return reason, nil
			}
			if analysis.NeedsConfirmation {
				return fmt.Sprintf("Command requires explicit approval before running. Use: senny allow-command %q [--scope project|global|session]", args.Command), nil
			}
			return next(ctx, tc)
		}
	}
}

func sessionDir() string {
	dir, err := sessionpkg.SessionDir()
	if err == nil {
		return dir
	}
	return filepath.Join(os.TempDir(), "senny-sessions")
}

func (s *Server) cancel(sessionID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	session := s.sessions[sessionID]
	if session == nil || session.Cancel == nil {
		return false
	}
	session.Cancel()
	return true
}

func (s *Server) writeErr(id json.RawMessage, code int, err error) {
	s.write(Response{JSONRPC: "2.0", ID: id, Error: &Error{Code: code, Message: err.Error()}})
}

func (s *Server) notify(method string, params any) {
	s.write(Notification{JSONRPC: "2.0", Method: method, Params: params})
}

func (s *Server) write(msg any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = json.NewEncoder(s.out).Encode(msg)
}

func decode(raw json.RawMessage, dst any) error {
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	return json.Unmarshal(raw, dst)
}

func truncate(value string, max int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= max {
		return string(runes)
	}
	return string(runes[:max]) + "..."
}
