# Packaging Notes

The current npm package ships the TypeScript output plus bundled native Go binaries:

- `core-go/bin/senny-core`
- `core-go/bin/senny-late`
- `core-go/bin/senny-mcp-run`

This is simple and reliable, but it makes the package larger than a pure TypeScript package.

Recommended release path:

1. Keep the current bundled-binary package for early releases.
2. Add platform-specific optional packages when release volume justifies it.
3. Move `senny-core`, `senny-late`, and `senny-mcp-run` into per-platform artifacts.
4. Keep `senny-cli` as the small TypeScript wrapper package that selects the right binary package.

The release workflow builds on macOS, Linux, and Windows and uploads native artifacts so this split can happen later without changing the core architecture.
