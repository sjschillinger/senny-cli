# Runtime Notes

Senny uses a hybrid runtime:

- The native Go core keeps Late-style local-agent work efficient.
- The TypeScript layer gives Senny a first-class SDK and CLI integration surface.
- Node remains the conservative default runtime for compatibility with npm, MCP, stdio, signals, and common TypeScript tooling.
- Bun is supported for measurement and lightweight wrapper experiments.

## Memory Benchmark

Build first:

```bash
npm run build
```

Measure the Node wrapper plus native core:

```bash
npm run bench:runtime:node
```

Measure the Bun wrapper plus native core:

```bash
npm run bench:runtime:bun
```

Run both:

```bash
npm run bench:runtime
```

The benchmark starts `senny-core`, waits briefly, reads wrapper and core RSS, prints JSON, then shuts the core down.

Expect the native-only `senny-late` binary to stay closest to original Late memory usage. The TypeScript-facing `senny` path adds the wrapper runtime overhead.
