package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"senny/internal/client"
	"senny/internal/common"
	"senny/internal/compact"
	"senny/internal/pathutil"
	"senny/internal/session"
	"senny/internal/skill"
	"senny/internal/tool"
)

// --- Stream Accumulator ---

// StreamAccumulator collects streaming deltas into coherent content.
// This replaces the duplicated accumulation logic in tui/state.go (GenerationState.Append)
// and agent/agent.go (manual accumulation loop).
type StreamAccumulator struct {
	Content      string
	Reasoning    string
	ToolCalls    []client.ToolCall
	Usage        client.Usage
	FinishReason string
}

// Append merges a single streaming delta into the accumulated state.
func (a *StreamAccumulator) Append(res common.StreamResult) {
	a.Content += res.Content
	a.Reasoning += res.ReasoningContent

	if res.Usage.TotalTokens > 0 {
		a.Usage = res.Usage
	}

	if res.FinishReason != "" {
		a.FinishReason = res.FinishReason
	}

	for _, delta := range res.ToolCalls {
		index := delta.Index
		if index < len(a.ToolCalls) {
			a.ToolCalls[index].Function.Arguments += delta.Function.Arguments
			if delta.Function.Name != "" {
				a.ToolCalls[index].Function.Name = delta.Function.Name
			}
			if delta.ID != "" {
				a.ToolCalls[index].ID = delta.ID
			}
		} else {
			a.ToolCalls = append(a.ToolCalls, delta)
		}
	}
}

// Reset clears all accumulated state.
func (a *StreamAccumulator) Reset() {
	a.Content = ""
	a.Reasoning = ""
	a.ToolCalls = nil
	a.FinishReason = ""
}

// --- Tool Execution ---

// ExecuteToolCalls runs a slice of tool calls against the session.
// It uses the provided middlewares to wrap the base tool execution.
// Results are added to the session history.
func ExecuteToolCalls(ctx context.Context, sess *session.Session, toolCalls []client.ToolCall, middlewares []common.ToolMiddleware) error {
	// Base execution logic
	baseRunner := func(ctx context.Context, tc client.ToolCall) (string, error) {
		t := sess.Registry.Get(tc.Function.Name)
		if t == nil {
			return fmt.Sprintf("Error: tool '%s' not found", tc.Function.Name), nil
		}
		return sess.ExecuteTool(ctx, tc)
	}

	// Wrap with middlewares (in reverse order so first middleware is outermost)
	runner := baseRunner
	for i := len(middlewares) - 1; i >= 0; i-- {
		runner = middlewares[i](common.ToolRunner(runner))
	}

	for _, tc := range toolCalls {
		// Fail-closed: if no confirmation middleware is provided, do not
		// execute shell commands (they must be explicitly approved by a
		// middleware such as the TUI confirm middleware).
		if len(middlewares) == 0 {
			if t := sess.Registry.Get(tc.Function.Name); t != nil {
				if _, ok := t.(*tool.ShellTool); ok {
					result := "shell command requires explicit approval before execution"
					if err := sess.AddToolResultMessage(tc.ID, result); err != nil {
						return err
					}
					continue
				}
			}
		}

		result, err := runner(ctx, tc)
		if err != nil {
			result = fmt.Sprintf("Error executing tool %s: %v", tc.Function.Name, err)
		}
		if err := sess.AddToolResultMessage(tc.ID, result); err != nil {
			return err
		}
	}
	return nil
}

// --- Tool Registration ---

// RegisterTools registers the common tool set on a session's registry.
// If isPlanning is true, it only registers read-only tools and the planning tool.
// Otherwise, it registers the full set of coding tools.
// cache is optional; pass nil to skip file-content caching.
func RegisterTools(reg *tool.Registry, enabledTools map[string]bool, isPlanning bool, cache ...*tool.FileCache) {
	if enabledTools == nil {
		enabledTools = make(map[string]bool)
	}
	var fc *tool.FileCache
	if len(cache) > 0 {
		fc = cache[0]
	}

	// Always register read-only and base tools
	if enabledTools["read_file"] {
		if fc != nil {
			reg.Register(tool.NewReadFileToolWithCache(fc))
		} else {
			reg.Register(tool.NewReadFileTool())
		}
	}
	if enabledTools["bash"] {
		reg.Register(&tool.ShellTool{})
	}

	if isPlanning {
		// Planning-only tools
		reg.Register(tool.WriteImplementationPlanTool{})
	} else {
		// Coding-only tools
		if enabledTools["write_file"] {
			if fc != nil {
				reg.Register(tool.NewWriteFileToolWithCache(fc))
			} else {
				reg.Register(tool.NewWriteFileTool())
			}
		}
		if enabledTools["target_edit"] {
			if fc != nil {
				reg.Register(tool.NewTargetEditToolWithCache(fc))
			} else {
				reg.Register(tool.NewTargetEditTool())
			}
		}
	}

	// Register Skills
	skillDirs := []string{}
	if userSkillsDir, err := pathutil.LateSkillsDir(); err == nil {
		skillDirs = append(skillDirs, userSkillsDir)
	}
	skillDirs = append(skillDirs, pathutil.SennyProjectSkillsDir())
	skillDirs = append(skillDirs, pathutil.LateProjectSkillsDir())

	skills, err := skill.DiscoverSkills(skillDirs)
	if err == nil && len(skills) > 0 {
		skillMap := make(map[string]*skill.Skill)
		for _, s := range skills {
			skillMap[s.Metadata.Name] = s
		}
		reg.Register(tool.ActivateSkillTool{
			Skills: skillMap,
			Reg:    reg,
		})
	}
}

// --- Consume Stream ---

// ConsumeStream drains a stream channel pair into a StreamAccumulator.
// It calls onChunk (if non-nil) for each delta, enabling real-time UI updates.
// Returns the final accumulated state or an error.
func ConsumeStream(
	ctx context.Context,
	outCh <-chan common.StreamResult,
	errCh <-chan error,
	onChunk func(common.StreamResult),
) (*StreamAccumulator, error) {
	acc := &StreamAccumulator{}

	for res := range outCh {
		acc.Append(res)
		if onChunk != nil {
			onChunk(res)
		}

		// Check for context cancellation (stop request)
		select {
		case <-ctx.Done():
			// Context cancelled - stop streaming but return accumulated data
			return acc, nil
		default:
			// Continue streaming
		}
	}

	// Check for stream error
	select {
	case err, ok := <-errCh:
		if ok && err != nil {
			return acc, fmt.Errorf("stream error: %w", err)
		}
	default:
	}

	return acc, nil
}

// --- Full Run Loop (Blocking) ---

// RunLoop handles the core, blocking event loop for autonomous agents.
// It forces the sequence: inference stream -> verifiable accumulation -> history commit -> safe tool execution.
// If the deterministic tool extraction yields zero calls, the loop securely collapses and returns execution control.

func RunLoop(
	ctx context.Context,
	sess *session.Session,
	maxTurns int,
	extraBody map[string]any,
	onStartTurn func(),
	onEndTurn func(),
	onStreamChunk func(common.StreamResult),
	middlewares []common.ToolMiddleware,
) (string, client.Usage, error) {
	var lastContent string
	var cumUsage client.Usage
	var lastCompactTurn = -3 // allow compaction from the first eligible turn

	for i := 0; maxTurns <= 0 || i < maxTurns; i++ {
		if onStartTurn != nil {
			onStartTurn()
		}

		streamCh, errCh := sess.StartStream(ctx, extraBody)
		acc, err := ConsumeStream(ctx, streamCh, errCh, onStreamChunk)
		if err != nil {
			return "", cumUsage, err
		}

		if acc.Usage.TotalTokens > 0 {
			cumUsage = acc.Usage
		}

		if acc.FinishReason == "length" {
			return "", cumUsage, fmt.Errorf("exceeds the available context size")
		}

		// If stopped, the last tool call might be partially streamed and thus invalid JSON.
		// We shouldn't save corrupted tool calls to the session history.
		if ctx.Err() != nil {
			var validCalls []client.ToolCall
			for _, tc := range acc.ToolCalls {
				// A simple check: if the arguments are valid JSON, keeping it is probably safe.
				// Otherwise, it was cut off mid-stream.
				if json.Valid([]byte(tc.Function.Arguments)) {
					validCalls = append(validCalls, tc)
				}
			}
			acc.ToolCalls = validCalls
		}

		if err := sess.AddAssistantMessageWithTools(acc.Content, acc.Reasoning, acc.ToolCalls); err != nil {
			return "", cumUsage, fmt.Errorf("failed to save history: %w", err)
		}

		if onEndTurn != nil {
			onEndTurn()
		}

		// Attempt compaction if token usage is high and enough turns have passed.
		if cumUsage.PromptTokens > 0 && (i-lastCompactTurn) >= 3 {
			ctxSize := sess.Client().ContextSize()
			if compact.ShouldCompact(cumUsage.PromptTokens, ctxSize) {
				if summary, replacedIDs, cerr := compact.CompactSession(ctx, sess.Client(), sess.History, sess.SystemPrompt()); cerr == nil {
					if werr := session.WriteCompactBoundary(sess.HistoryPath, replacedIDs, summary); werr == nil {
						sess.ApplyCompaction(replacedIDs, summary)
						lastCompactTurn = i
						fmt.Fprintf(os.Stderr, "[compacted: %d messages → 1 summary]\n", len(replacedIDs))
					}
				}
			}
		}

		if len(acc.ToolCalls) == 0 {
			return acc.Content, cumUsage, nil
		}

		lastContent = acc.Content

		// If a stop was requested, break the loop before executing tools
		select {
		case <-ctx.Done():
			return lastContent + "\n\n(Stopped by user)", cumUsage, nil
		default:
		}

		if err := ExecuteToolCalls(ctx, sess, acc.ToolCalls, middlewares); err != nil {
			return "", cumUsage, err
		}

		// Also check after tool execution in case user requested stop during a long tool
		select {
		case <-ctx.Done():
			return lastContent + "\n\n(Stopped by user)", cumUsage, nil
		default:
		}
	}

	return lastContent + "\n\n(Terminated due to max turns limit)", cumUsage, nil
}
