# Senny Project-State Migration

Senny remains compatible with Late project state, but new Senny-first projects can keep local state in `.senny`.

Supported project files:

- `.senny/mcp_config.json`
- `.senny/allowed_tools.json`
- `.senny/allowed_commands.json`
- `.senny/skills/`

Late-compatible files are still read where needed:

- `.late/mcp_config.json`
- `.late/allowed_tools.json`
- `.late/allowed_commands.json`
- `.late/skills/`

Copy project state from `.late` into `.senny`:

```bash
senny-cli migrate senny
```

Overwrite existing `.senny` files:

```bash
senny-cli migrate senny --force
```

The migration command copies files; it does not delete `.late`, so existing Late-compatible workflows keep working.
