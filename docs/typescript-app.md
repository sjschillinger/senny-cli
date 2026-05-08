# TypeScript App Integration

Senny exposes the native Go core through a TypeScript SDK.

```ts
import { SennyCoreClient } from "senny-cli/dist/sdk/index.js";

const client = await SennyCoreClient.start({ cwd: process.cwd() });

try {
  const config = await client.getConfig();
  const tools = await client.listTools({ cwd: process.cwd() });
  const session = await client.createSession({ cwd: process.cwd() });

  client.on("event", (event) => {
    if (event.type === "stream") {
      process.stdout.write(String(event.delta ?? ""));
    }
  });

  await session.run("Inspect this project");
} finally {
  await client.shutdown();
}
```

Useful SDK calls:

- `getConfig()`
- `listMCP(cwd)`
- `listTools({ cwd, planning })`
- `listPermissions(cwd)`
- `allowTool(name, scope, cwd)`
- `allowCommand(command, scope, cwd)`
- `createSession({ cwd, model, resume })`
- `listSessions()`
- `deleteSession(id)`
- `listWorktrees()`

The SDK keeps API keys redacted when returning config. It reports `hasApiKey` rather than returning secrets.
