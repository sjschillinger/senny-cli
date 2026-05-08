import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Agent } from "../dist/agent.js";

const baseConfig = {
  openAIBaseURL: "http://unused",
  openAIAPIKey: "",
  openAIModel: "",
  subagentBaseURL: "http://unused",
  subagentAPIKey: "",
  subagentModel: "",
  enabledTools: { read_file: true, write_file: true, target_edit: true, bash: true, spawn_subagent: false },
  maxTurns: 3,
  compactAfterTokens: 10000,
  approvalMode: "auto",
  mcpServers: {}
};

class ScriptedClient {
  constructor(chunks) {
    this.chunks = chunks;
    this.calls = 0;
  }
  async *streamChat() {
    const chunkSet = this.chunks[this.calls++] ?? [];
    for (const chunk of chunkSet) yield chunk;
  }
}

test("agent asks for repair after invalid tool JSON", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "senny-agent-"));
  try {
    const client = new ScriptedClient([
      [
        {
          content: "",
          reasoning: "",
          toolCalls: [{ id: "call1", type: "function", function: { name: "read_file", arguments: "{" } }]
        }
      ],
      [{ content: "Recovered", reasoning: "", toolCalls: [] }]
    ]);
    const events = [];
    const agent = new Agent(client, "system", {
      cwd,
      config: baseConfig,
      unsafe: true,
      onEvent: (event) => events.push(event)
    });
    const result = await agent.run("go");
    assert.equal(result, "Recovered");
    assert.equal(events.some((event) => event.type === "retry"), true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
