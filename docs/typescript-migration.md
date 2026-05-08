# TypeScript Migration

Senny's TypeScript architecture is intended to become the primary implementation path for future Senny work.

## Source Boundaries

- `references/late-cli` is the upstream fork reference and behavioral baseline.
- The TypeScript implementation in `src/` is an original Senny implementation.
- Claude Code reference files are treated only as high-level product inspiration. Senny should not translate, closely paraphrase, or mirror Claude Code source, module layout, prompt text, control flow, names, or private abstractions.

## Current Architecture

- `src/cli.ts`: command-line entrypoint.
- `src/client.ts`: OpenAI-compatible streaming client.
- `src/session.ts`: persistent chat history and model-message assembly.
- `src/agent.ts`: turn loop, tool execution, subagent spawning.
- `src/tools/`: core project tools and registry.
- `src/memory.ts`: project memory injection from `SENNY.md`, `AGENTS.md`, and `.senny/memory.md`.
- `src/compact.ts`: deterministic history compaction.
- `src/summaries.ts`: compact tool-result summaries.
- `src/mcp.ts`: stdio MCP bridge.
- `src/skills.ts`: Late-style Agent Skills.
- `src/permissions.ts`: scoped approval persistence.

## Migration Order

1. Keep the TypeScript CLI usable in non-interactive mode. Done.
2. Add interactive mode with terminal approvals. Done.
3. Add worktree commands and session list/load/delete commands. Done.
4. Add automated tests for core safety behavior. Done.
5. Port MCP support against the TypeScript SDK. Done for stdio tools.
6. Add cancellation and live turn/tool status to the current interactive shell. Done.
7. Expand subagent handoffs and repair loops. Done for scoped helper agents.
8. Add a richer TUI with panels and keyboard shortcuts.
9. Add browser and remote-session support as Senny-native capabilities.

## Full Conversion Status

The TypeScript codebase now covers Late's core harness surfaces: client streaming, sessions, tools, permissions, worktrees, MCP stdio tools, skills, subagents, memory, compaction, and CLI commands.

The hybrid architecture keeps the authorized Go implementation in `core-go`, including the native Late TUI and MCP runner entrypoints, while exposing `senny-core` over stdio JSON-RPC for TypeScript systems.

The TypeScript CLI defaults one-shot prompts to the native Go core. Use `--ts` to select the prototype TypeScript harness path for comparison or migration work.

## Design Principles

- Preserve the project-root containment rule.
- Keep session history durable and debuggable JSON.
- Prefer deterministic summaries before model-generated summaries.
- Treat mutating tools as approval-gated unless explicitly unsafe.
- Keep subagents scoped and short-lived.
