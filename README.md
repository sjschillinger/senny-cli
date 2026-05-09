# Senny CLI

Senny is a TypeScript-first coding-agent harness derived from the public behavior and goals of Late CLI, with an architecture intended for future Senny development.

This repository is a fork of Late CLI and preserves the upstream fork history as the behavioral baseline. Local reference checkouts under `references/` are intentionally ignored and are not required to build or use Senny. Claude Code reference files may inform product goals at a high level, but Senny's TypeScript implementation is original and does not port or closely rewrite Claude Code source.

## Architecture

Senny is pivoting to a hybrid architecture:

- `core-go/`: native Go harness core exposed over stdio JSON-RPC.
- `core-go/cmd/late`: authorized Late native TUI entrypoint preserved as `senny-late` in builds.
- `core-go/cmd/mcp-run`: authorized Late MCP runner entrypoint preserved as `senny-mcp-run` in builds.
- `src/sdk/`: TypeScript SDK that starts and talks to the native core.
- `src/`: TypeScript CLI, prototype harness modules, MCP/skills adapters, and integration layer.

This keeps local-agent efficiency close to Late while preserving a first-class TypeScript integration surface for Senny. The TypeScript CLI defaults one-shot prompts to the bundled native Go core; the prototype TypeScript path remains available with `--ts`.

## Status

This is a usable TypeScript Senny base. It includes:

- OpenAI-compatible streaming client
- Persistent sessions
- Read, write, exact-replace edit, and bash tools
- Permission checks for mutating tools
- Project memory injection from `SENNY.md`, `AGENTS.md`, and `.senny/memory.md`
- Lightweight context compaction for long sessions
- Tool-use summaries after tool execution
- Session list/load/delete commands
- Git worktree commands
- Stdio MCP tool registration from config
- Cancellation-aware interactive runs
- Conservative command analysis for shell safety
- Late-style Agent Skills from `SKILL.md`
- Local/global/session allow-lists with TTL metadata
- Late-compatible session metadata JSON shape

## Usage

```bash
npm install
npm run build
OPENAI_BASE_URL=http://localhost:8080 senny-cli "inspect this project"
```

Run `senny-cli --help` for flags.

## Commands

```bash
senny-cli                         # native Go TUI
senny-cli --ts                    # TypeScript readline mode
senny-cli "make a focused change"  # one-shot through native Go core
senny-cli --ts "prototype path"     # one-shot through TypeScript prototype fallback
senny-cli session list
senny-cli session load <id-prefix>
senny-cli session delete <id-prefix>
senny-cli worktree list
senny-cli worktree create <path> [ref]
senny-cli worktree remove <path>
senny-cli worktree active
senny-cli mcp list
senny-cli migrate senny
senny-cli core config
senny-cli core tools --planning
```

Mutating tools prompt before running in interactive use. Use `--unsafe` or `--yes` only when you intentionally approve those changes.

The default no-argument interactive path launches the native Go TUI for Late-style terminal behavior. The TypeScript readline loop remains available with `senny-cli --ts`.

## MCP

Add MCP stdio servers to `~/.config/senny/config.json`:

```json
{
  "mcpServers": {
    "example": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}
```

Tools are exposed to the model as `mcp_<server>_<tool>`.

Senny loads project MCP config from `.senny/mcp_config.json`, then falls back to Late-style `.late/mcp_config.json`, and expands `${ENV_VAR}` references.

## Skills

Place skills under `~/.config/senny/skills`, `.late/skills`, or `.senny/skills`. Each skill directory should contain a `SKILL.md` with YAML frontmatter:

```markdown
---
name: demo
description: Demo skill
---
Skill instructions go here.
```

After the model calls `activate_skill`, scripts in `scripts/` are exposed as `skill_<skill>_<script>` tools.

## Verification

```bash
npm run check
```

The check script builds the project, runs the test suite, verifies CLI help, and performs an npm package dry run.

## Runtime Benchmarks

```bash
npm run bench:runtime
```

This measures the TypeScript wrapper and native Go core under Node and Bun. See `docs/runtime.md` for details.

## TypeScript Integration

Use the SDK when embedding Senny into a TypeScript application. See `docs/typescript-app.md`.

## Real-Model Smoke Test

```bash
OPENAI_BASE_URL=http://localhost:8080 npm run smoke:real
```

This runs the default TypeScript-facing CLI path against a real OpenAI-compatible endpoint.
