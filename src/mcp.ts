import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { SennyConfig, Tool } from "./types.js";
import type { ToolRegistry } from "./tools/registry.js";

interface ConnectedMCP {
  name: string;
  client: Client;
  transport: StdioClientTransport;
}

export interface MCPToolInfo {
  server: string;
  name: string;
  registeredName: string;
  description: string;
}

export class MCPManager {
  private readonly connections: ConnectedMCP[] = [];
  readonly tools: MCPToolInfo[] = [];
  readonly errors: string[] = [];

  async connectConfigured(config: SennyConfig, registry: ToolRegistry, cwd: string): Promise<void> {
    for (const [serverName, server] of Object.entries(config.mcpServers)) {
      if (server.enabled === false) continue;
      try {
        const transport = new StdioClientTransport({
          command: server.command,
          args: server.args ?? [],
          env: server.env,
          cwd: server.cwd ?? cwd,
          stderr: "inherit"
        });
        const client = new Client({ name: "senny-cli", version: "0.1.0" });
        await client.connect(transport);
        this.connections.push({ name: serverName, client, transport });

        const listed = await client.listTools();
        for (const mcpTool of listed.tools) {
          const name = `mcp_${sanitize(serverName)}_${sanitize(mcpTool.name)}`;
          const description = `[MCP:${serverName}] ${mcpTool.description ?? mcpTool.name}`;
          const tool: Tool = {
            name,
            description,
            parameters: mcpTool.inputSchema,
            mutates: !mcpTool.annotations?.readOnlyHint,
            run: async (args) => {
              const result = await client.callTool({ name: mcpTool.name, arguments: asRecord(args) });
              if ("toolResult" in result) return JSON.stringify(result.toolResult, null, 2);
              return result.content.map(renderContent).join("\n");
            },
            summarize: () => `called MCP tool ${serverName}/${mcpTool.name}`
          };
          this.tools.push({ server: serverName, name: mcpTool.name, registeredName: name, description });
          registry.register(tool);
        }
      } catch (err) {
        this.errors.push(`${serverName}: ${(err as Error).message}`);
      }
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.connections.map((conn) => conn.transport.close()));
  }
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([^a-zA-Z_])/, "_$1");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function renderContent(part: unknown): string {
  const item = part as Record<string, unknown>;
  if (item.type === "text") return String(item.text ?? "");
  if (item.type === "resource") return JSON.stringify(item.resource, null, 2);
  return JSON.stringify(item, null, 2);
}
