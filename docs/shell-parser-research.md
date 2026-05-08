# Shell Parser Research

Goal: support Late-style command safety analysis in TypeScript without relying on regex-only parsing.

## Options Reviewed

### `sh-syntax`

- WASM shell parser/formatter with Bash support.
- Based on `mvdan/sh`, the same parser family used by Late's Go implementation.
- Ships TypeScript declarations and avoids native `node-gyp` builds.
- Good fit for validating shell syntax and detecting redirects.

### `tree-sitter-bash`

- Strong concrete syntax tree for editor/language tooling.
- Native Node bindings failed to build cleanly in this workspace on Node 24 without extra C++20 build configuration.
- Better as an optional future adapter than as Senny's default parser dependency.

### `bash-parser`

- Pure JavaScript package that produces a Bash AST.
- Older ecosystem and less aligned with Late's `mvdan/sh` behavior.
- Useful fallback candidate, but not the best primary parser for Late parity.

## Decision

Use `sh-syntax` as the primary parser. It gives Senny the closest implementation lineage to Late's Go parser while remaining package-friendly for a TypeScript CLI.

Current implementation:

- `src/shell-parser.ts` parses commands with `sh-syntax`.
- `src/tools/core.ts` uses parser facts before executing shell commands.
- `src/safety.ts` combines parser facts with command risk classification.

Known limitation: the current `sh-syntax` JSON output exposes statement spans and redirects more reliably than detailed command-word nodes, so Senny still uses a small tokenizer for allow-list key extraction. This is still safer than regex-only execution because parser rejection and AST redirect detection happen before command execution.
