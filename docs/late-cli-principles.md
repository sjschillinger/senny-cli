# Late-CLI: Design Principles & Purpose

## The Core Problem It Was Built to Solve

Late starts from a specific, confident premise: the industry default of feeding an ever-growing session history into a single model context window is architecturally broken at scale. Token bloat degrades model quality, long sessions cause "amnesia" and hallucination cascades, and the more history a context holds, the worse the edits become — not better.

The README states it plainly: *"Standard AI coding assistants dump massive contexts into a single window, leading to token bloat, amnesia, hallucinations and degraded ability."*

Late's answer isn't a better model or more VRAM — it's organizational structure. It mirrors how real engineering teams work: a Lead Architect plans and delegates, isolated Engineers execute specific tasks, and no individual holds the entire codebase in working memory at once.

---

## Why Go

Three reasons, all load-bearing:

**1. Local-first, low-VRAM constraint.** The explicit design target is 5GB VRAM with local models. Go's static binary adds essentially zero overhead to the hardware budget. A Node.js or Python runtime would eat into that.

**2. Zero-dependency single binary.** The `go.mod` has only a handful of dependencies: Charm's TUI libraries, the MCP SDK, a YAML parser, a shell parser. No `node_modules`, no pip installs. *"Zero to first prompt in seconds"* is a stated goal, and Go delivers that.

**3. Cross-platform correctness.** Late has real Windows support — it ships a PowerShell AST analyzer and Windows-specific approval logic. Go's cross-compilation story makes this tractable in a way that Python or interpreted languages aren't.

---

## The Orchestrator / Subagent Architecture

This is the heart of Late's design and the thing that makes it different.

The orchestrator (Lead Architect) is deliberately crippled: it can read files, search the codebase, and spawn subagents — but **it cannot write files or run mutations directly**. Its only write tool is `write_implementation_plan.md`. It is physically incapable of making changes.

Subagents are spawned per task, given a fresh context with only the system prompt and curated context from the parent, execute their bounded work, and then their histories are **destroyed**. They never write to the sessions directory. From the code: `sess := session.New(c, "", []client.ChatMessage{}, systemPrompt, true)` — an empty history path means it never persists.

The reasoning (from the README): *"When a sub-agent finishes its task, its history is destroyed. It never pollutes the planner's context."*

This separation exists to:
- Force a plan → execution pipeline (the orchestrator can't skip planning)
- Prevent hallucination cascades from early edits confusing later ones
- Keep the orchestrator's context window permanently lean and focused
- Isolate failures (a subagent that goes wrong doesn't poison the session)

---

## The Permission System

Late is explicit about who's in charge: *"You are always the final authority."*

But the permission system is also engineered to stay out of your way for things that don't matter. The design principle is stated directly in the README: *"Late knows the difference between gathering context and changing state — it stays out of your way for the safe stuff, and hard-stops for your approval on the rest."*

The implementation uses AST-based shell analysis (not regex) to classify commands:

- **Read-only** (`ls`, `cat`, `grep`, `find`): auto-approved, no prompt
- **Mutating or ambiguous**: hard stop for user approval
- **`cd`**: blocked entirely — changing the orchestrator's working directory would break session state

Approvals carry scoped TTL decay: session (30 min, in-memory only), project (30 days, `.late/`), global (30 days, `~/.config/late/`). This reduces friction without creating stale blanket permissions.

One deliberate asymmetry: on Windows, **shell commands are never auto-approved**, even with the unsafe flag set. PowerShell is judged to be more dangerous than Bash by default.

---

## The Edit Model

Late rejects diff formats and approximate patches. It uses exact-match `search`/`replace` string blocks exclusively.

From the README: *"Standard agents use fragile diff formats that frequently hallucinate and corrupt files. Late forces subagents to use strict exact-match search/replace string blocks. If the model fails the match, the edit fails loudly, and the Agent initiates an autonomous self-healing loop until it gets it right."*

Loudness is a feature. Silent file corruption from approximate diffs is considered worse than an edit that fails and retries. The model self-heals by re-reading the file and narrowing the search block — this is deterministic and auditable, unlike approximate patching.

---

## Model Routing

Late supports two separate OpenAI-compatible endpoints: one for the orchestrator, one for subagents. The intent is cost and speed optimization:

- **Orchestrator**: a large, capable model (Claude, GPT-4-class) for complex architectural reasoning
- **Subagents**: a fast, cheap model (Gemma, smaller Llama) for focused, bounded edits

The system prompt for the orchestrator is described as *"ruthlessly optimized"* at ~1,000 tokens. Every token in the orchestrator context is load-bearing — there's no padding, no preamble.

---

## Licensing Philosophy

Late uses Business Source License 1.1, converting to GPLv2 in 2030. The README is explicit: *"We built this to generate real engineering leverage, not to supply free backend infrastructure for AI startups."* You can use it for your own commercial projects freely; you cannot wrap it as a SaaS product without a commercial agreement.

---

## The Core Design Ethos

Every decision in Late serves one thesis: **quality and scale are inversely related in monolithic agent contexts, and the solution is organizational structure, not more compute.**

- Go instead of Node: zero overhead, instant startup, local-first
- Orchestrator/subagent split: isolation prevents context pollution
- Ephemeral subagent sessions: destroyed after use, never polluting the planner
- Exact-match edits: loud failures, deterministic self-healing
- AST-based shell analysis: correctness over convenience
- Scoped permission decay: reduces friction without creating permanent trust
- Lean system prompts: every token is intentional

Late isn't trying to be the most capable agent. It's trying to be the most reliable one at low resource cost — and it achieves that by treating context management as an architectural problem, not a model quality problem.
