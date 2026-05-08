# Late Compatibility Notes

Senny's TypeScript implementation is a new harness that preserves Late-style behavior where it matters to users, while leaving room for Senny-specific architecture.

## Implemented

- Authorized Late Go packages are imported under `core-go/internal`.
- Native Late CLI entrypoints are preserved under `core-go/cmd/late` and `core-go/cmd/mcp-run`.
- `senny-core` exposes the native core over stdio JSON-RPC for TypeScript integration.
- TypeScript one-shot prompts default to the native Go core; `--ts` explicitly selects the prototype TypeScript path.
- OpenAI-compatible chat streaming.
- Persistent JSON sessions.
- `session list`, `session load`, and `session delete`.
- `worktree list`, `worktree create`, `worktree remove`, and `worktree active`.
- Read, write, exact replacement edit, and shell tools.
- Project-root path containment for file tools.
- Approval-gated mutating tools, with read-only shell command auto-approval.
- Stdio MCP tools from config.
- Late-style `.late/mcp_config.json` loading with `${ENV_VAR}` expansion.
- Memory context from `SENNY.md`, `AGENTS.md`, and `.senny/memory.md`.
- Deterministic compaction and tool-use summaries.
- Scoped subagent tool.
- Agent Skills discovery and activation from `SKILL.md`.
- Local/global/session allow-lists with TTL metadata.
- Session metadata fields use Late-compatible snake_case JSON names.

## Different By Design In The TypeScript Prototype Layer

- The TypeScript prototype layer uses Node runtime APIs for SDK/UI integration.
- The TypeScript interactive mode is line-oriented; the native Go Bubble Tea TUI remains available through `core-go/cmd/late`.
- Command analysis is conservative and intentionally blocks some ambiguous commands until approved.
- MCP support currently focuses on stdio tools. Resources and prompts can be added without changing the core registry model.
- The TypeScript shell analyzer uses `sh-syntax`; the native Go core retains Late's Go AST analyzer.

## Remaining Product Polish

- Rich terminal UI with panels, keyboard shortcuts, and persistent live tool status.
- Remote/browser session features.
- More model-provider compatibility fixtures.
- More integration tests with mock OpenAI and mock MCP servers.
- Full-screen TUI parity if Senny should preserve Late's exact terminal interface.
