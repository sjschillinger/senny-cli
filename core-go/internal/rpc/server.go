package rpc

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"senny/internal/assets"
	"senny/internal/client"
	"senny/internal/common"
	appconfig "senny/internal/config"
	"senny/internal/executor"
	"senny/internal/git"
	"senny/internal/mcp"
	memorypkg "senny/internal/memory"
	"senny/internal/pathutil"
	sessionpkg "senny/internal/session"
	"senny/internal/tool"
	"sort"
	"strings"
	"sync"
	"time"
)

type Server struct {
	in  io.Reader
	out io.Writer

	mu             sync.Mutex
	cwdMu          sync.Mutex
	approvalMu     sync.Mutex
	nextApprovalID int64
	approvals      map[string]chan approvalDecision
	sessions       map[string]*Session
}

type approvalDecision struct {
	Approved bool
	Scope    string
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
	return &Server{in: in, out: out, sessions: make(map[string]*Session), approvals: make(map[string]chan approvalDecision)}
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
			Capabilities:    []string{"sessions", "run", "cancel", "events", "config", "mcp", "tools", "permissions", "approvals", "session_inspect", "lifecycle_events"},
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
	case "approval/respond":
		var params ApprovalRespondParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		if err := s.respondApproval(params); err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: map[string]bool{"ok": true}})
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
	case "session/inspect":
		var params InspectSessionParams
		if err := decode(req.Params, &params); err != nil {
			s.writeErr(req.ID, -32602, err)
			return
		}
		result, err := inspectSavedSession(params.ID)
		if err != nil {
			s.writeErr(req.ID, -32000, err)
			return
		}
		s.write(Response{JSONRPC: "2.0", ID: req.ID, Result: result})
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
		if params.Planning && cfg.EnabledTools["spawn_subagent"] {
			reg.Register(tool.SpawnSubagentTool{})
		}
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
		cfg, _ := appconfig.LoadConfig()
		if cfg.EnabledTools["spawn_subagent"] {
			session.Late.Registry.Register(tool.SpawnSubagentTool{
				Runner: func(ctx context.Context, goal string, ctxFiles []string, agentType string) (string, error) {
					return s.runRPCSubagent(ctx, session.ID, session.CWD, goal, ctxFiles, agentType)
				},
			})
		}
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

func inspectSavedSession(id string) (map[string]any, error) {
	meta, err := sessionpkg.LoadSessionMeta(id)
	if err != nil {
		return nil, err
	}
	if meta == nil {
		return nil, fmt.Errorf("session not found: %s", id)
	}
	audit, err := sessionpkg.InspectHistory(meta.HistoryPath)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"meta":  meta,
		"audit": audit,
	}, nil
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
				res, usage, err := executor.RunLoop(
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
					[]common.ToolMiddleware{s.shellApprovalMiddleware(params.SessionID)},
					s.runHooks(params),
				)
				if err != nil {
					return err
				}
				exitCode := 0
				if strings.HasSuffix(res, "(Terminated due to max turns limit)") {
					exitCode = 3
				} else if strings.HasSuffix(res, "(Stopped by user)") {
					exitCode = 4
				}
				s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "done", "content": res, "exit_code": exitCode, "usage": usage})
				return nil
			})
			if err != nil {
				exitCode := 1
				if strings.Contains(err.Error(), "exceeds the available context size") {
					exitCode = 2
				}
				s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "error", "message": err.Error(), "exit_code": exitCode})
				return
			}
			return
		}
		select {
		case <-runCtx.Done():
			s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "cancelled", "exit_code": 4})
		default:
			s.notify("session/event", map[string]any{"sessionId": params.SessionID, "type": "done", "content": "native core skeleton ready", "exit_code": 0})
		}
	}()
	return nil
}

func (s *Server) runHooks(params RunParams) *executor.RunHooks {
	return &executor.RunHooks{
		DisableCompaction:      params.DisableCompaction,
		ForceCompaction:        params.ForceCompaction,
		CompactThresholdTokens: params.CompactThresholdTokens,
		OnToolEvent: func(event executor.ToolEvent) {
			payload := map[string]any{
				"sessionId": params.SessionID,
				"type":      event.Type,
				"name":      event.Name,
				"id":        event.ID,
			}
			if event.Message != "" {
				payload["message"] = event.Message
			}
			if event.Error != "" {
				payload["error"] = event.Error
			}
			s.notify("session/event", payload)
		},
		OnCompactionEvent: func(event executor.CompactionEvent) {
			payload := map[string]any{
				"sessionId": params.SessionID,
				"type":      event.Type,
			}
			if event.ReplacedCount > 0 {
				payload["replaced_count"] = event.ReplacedCount
			}
			if event.SummaryID != "" {
				payload["summary_id"] = event.SummaryID
			}
			if event.Error != "" {
				payload["error"] = event.Error
			}
			s.notify("session/event", payload)
		},
	}
}

func (s *Server) runRPCSubagent(ctx context.Context, parentSessionID, cwd, goal string, ctxFiles []string, agentType string) (string, error) {
	if agentType == "" {
		agentType = "coder"
	}
	if agentType != "coder" {
		return "", fmt.Errorf("unknown agent type: %s", agentType)
	}
	s.notify("session/event", map[string]any{"sessionId": parentSessionID, "type": "subagent_started", "goal": goal, "agent_type": agentType})

	cfg, _ := appconfig.LoadConfig()
	openAI := appconfig.ResolveOpenAISettings(cfg)
	settings := appconfig.ResolveSubagentSettings(cfg, openAI)
	c := client.NewClient(client.Config{BaseURL: settings.BaseURL, APIKey: settings.APIKey, Model: settings.Model})
	c.DiscoverBackend(ctx)
	promptBytes, _ := assets.PromptsFS.ReadFile("prompts/instruction-coding.md")
	sub := sessionpkg.New(c, "", []client.ChatMessage{}, string(promptBytes), true)
	executor.RegisterTools(sub.Registry, cfg.EnabledTools, false, tool.NewFileCache())

	var initial strings.Builder
	initial.WriteString("Goal: ")
	initial.WriteString(goal)
	initial.WriteString("\n\nReturn your final answer with these sections: Status, Files changed, Tests run, Blockers, Summary.\n")
	if len(ctxFiles) > 0 {
		initial.WriteString("\nContext Files:\n")
		for _, f := range ctxFiles {
			clean := filepath.Clean(f)
			if !tool.IsSafePath(clean) {
				continue
			}
			data, err := os.ReadFile(clean)
			if err == nil {
				initial.WriteString(fmt.Sprintf("- %s:\n```\n%s\n```\n", clean, string(data)))
			}
		}
	}
	if err := sub.AddUserMessage(initial.String()); err != nil {
		return "", err
	}

	res, usage, err := executor.RunLoop(ctx, sub, 200, nil, nil, nil, func(result common.StreamResult) {
		s.notify("session/event", map[string]any{"sessionId": parentSessionID, "type": "subagent_stream", "delta": result})
	}, []common.ToolMiddleware{s.shellApprovalMiddleware(parentSessionID)}, &executor.RunHooks{
		OnToolEvent: func(event executor.ToolEvent) {
			s.notify("session/event", map[string]any{
				"sessionId": parentSessionID,
				"type":      "subagent_" + event.Type,
				"name":      event.Name,
				"id":        event.ID,
				"message":   event.Message,
				"error":     event.Error,
			})
		},
	})
	status := "completed"
	if err != nil {
		status = "failed"
	}
	s.notify("session/event", map[string]any{"sessionId": parentSessionID, "type": "subagent_finished", "status": status, "usage": usage})
	if err != nil {
		return "", err
	}
	return res, nil
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
	basePrompt := strings.ReplaceAll(string(promptBytes), "${{CWD}}", cwd)
	systemPrompt := buildSystemPromptWithMemory(cwd, basePrompt)
	historyPath := filepath.Join(sessionDir(), id+".json")
	history, _ := sessionpkg.LoadHistory(historyPath)
	sess := sessionpkg.New(c, historyPath, history, systemPrompt, true)
	enabled := map[string]bool{"read_file": true, "bash": true, "write_file": true, "target_edit": true}
	executor.RegisterTools(sess.Registry, enabled, true, tool.NewFileCache())
	return sess
}

const globalMemoryCap = 2000  // chars (~500 tokens)
const projectMemoryCap = 8000 // chars (~2000 tokens)

// buildSystemPromptWithMemory appends any discovered memory context to the base system prompt.
// It loads global memory (~/.config/senny/MEMORY.md) and project memory (SENNY.md / LATE.md in cwd).
func buildSystemPromptWithMemory(cwd, base string) string {
	var blocks []string

	// Global memory
	if globalPath, err := pathutil.SennyGlobalMemoryPath(); err == nil {
		if data, err := os.ReadFile(globalPath); err == nil && len(data) > 0 {
			content := string(data)
			if len(content) > globalMemoryCap {
				content = content[:globalMemoryCap] + "\n... (truncated)"
			}
			blocks = append(blocks, "## Global Memory\n"+strings.TrimSpace(content))
		}
	}

	// Project memory — prefer SENNY.md, fall back to LATE.md; follow nested [path.md] links
	for _, name := range []string{"SENNY.md", "LATE.md"} {
		p := filepath.Join(cwd, name)
		if _, err := os.Stat(p); err == nil {
			content := memorypkg.LoadMemoryTree(p, cwd, projectMemoryCap)
			if strings.TrimSpace(content) != "" {
				blocks = append(blocks, fmt.Sprintf("## Project Memory (%s)\n", name)+strings.TrimSpace(content))
				break
			}
		}
	}

	if len(blocks) == 0 {
		return base
	}
	return base + "\n\n# Memory Context\n" + strings.Join(blocks, "\n\n")
}

// shellApprovalMiddleware enforces the bash analyzer allow-list before tool execution.
// Blocked commands return an error string; commands needing confirmation request live client approval.
func (s *Server) shellApprovalMiddleware(sessionID string) common.ToolMiddleware {
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
				decision, err := s.requestApproval(ctx, ApprovalRequest{
					SessionID:      sessionID,
					Kind:           "command",
					Command:        args.Command,
					Reason:         "Command requires explicit approval before running.",
					NeedsApproval:  true,
					SuggestedScope: "once",
					Scopes:         []string{"once", "session", "project", "global"},
					Allowed:        allowed,
				})
				if err != nil {
					return fmt.Sprintf("Command approval failed: %v", err), nil
				}
				if !decision.Approved {
					return "Command denied by user.", nil
				}
				switch decision.Scope {
				case "session":
					tool.SaveSessionAllowedCommand(args.Command)
				case "project":
					if err := tool.SaveAllowedCommand(args.Command, false); err != nil {
						return fmt.Sprintf("Command approval failed: %v", err), nil
					}
				case "global":
					if err := tool.SaveAllowedCommand(args.Command, true); err != nil {
						return fmt.Sprintf("Command approval failed: %v", err), nil
					}
				case "", "once":
				default:
					return fmt.Sprintf("Unknown approval scope: %s", decision.Scope), nil
				}
			}
			return next(ctx, tc)
		}
	}
}

func (s *Server) requestApproval(ctx context.Context, req ApprovalRequest) (approvalDecision, error) {
	s.approvalMu.Lock()
	s.nextApprovalID++
	req.ID = fmt.Sprintf("approval-%d", s.nextApprovalID)
	ch := make(chan approvalDecision, 1)
	s.approvals[req.ID] = ch
	s.approvalMu.Unlock()

	defer func() {
		s.approvalMu.Lock()
		delete(s.approvals, req.ID)
		s.approvalMu.Unlock()
	}()

	s.notify("approval/request", req)
	select {
	case decision := <-ch:
		return decision, nil
	case <-ctx.Done():
		return approvalDecision{}, ctx.Err()
	}
}

func (s *Server) respondApproval(params ApprovalRespondParams) error {
	if strings.TrimSpace(params.ID) == "" {
		return fmt.Errorf("approval id is required")
	}
	scope := strings.TrimSpace(params.Scope)
	if scope == "" {
		scope = "once"
	}
	switch scope {
	case "once", "session", "project", "global":
	default:
		return fmt.Errorf("unknown approval scope: %s", scope)
	}

	s.approvalMu.Lock()
	ch := s.approvals[params.ID]
	s.approvalMu.Unlock()
	if ch == nil {
		return fmt.Errorf("approval not found: %s", params.ID)
	}
	ch <- approvalDecision{Approved: params.Approved, Scope: scope}
	return nil
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
