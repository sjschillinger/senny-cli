import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Tool } from "./types.js";
import { Agent } from "./agent.js";
import { allowCommand, allowTool, isCommandAllowed, isToolAllowed } from "./permissions.js";

export async function runInteractive(agent: Agent): Promise<void> {
  const rl = readline.createInterface({ input, output });
  let controller: AbortController | undefined;
  const onSigint = () => {
    if (controller) {
      controller.abort();
      console.log("\nCancelling current run...");
      return;
    }
    rl.close();
  };
  process.on("SIGINT", onSigint);
  try {
    console.log("Senny interactive mode. Type /exit to quit. Press Ctrl-C during a run to cancel it.");
    for (;;) {
      const prompt = (await rl.question("\nsenny> ")).trim();
      if (!prompt) continue;
      if (prompt === "/exit" || prompt === "/quit") break;
      controller = new AbortController();
      try {
        await agent.run(prompt, controller.signal);
      } finally {
        controller = undefined;
        process.stdout.write("\n");
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
    rl.close();
  }
}

export async function approveInTerminal(tool: Tool, args: unknown): Promise<boolean> {
  const command = tool.name === "bash" && typeof args === "object" && args !== null ? String((args as Record<string, unknown>).command ?? "") : "";
  if (command && await isCommandAllowed(command)) return true;
  if (await isToolAllowed(tool.name)) return true;
  const rl = readline.createInterface({ input, output });
  try {
    console.log(`\nTool approval required: ${tool.name}`);
    console.log(JSON.stringify(args, null, 2));
    const answer = (await rl.question("Run this tool? [y]es / [n]o / [s]ession / [p]roject / [g]lobal: ")).trim().toLowerCase();
    if (answer === "s" || answer === "session") {
      if (command) await allowCommand(command, "session");
      else await allowTool(tool.name, "session");
      return true;
    }
    if (answer === "p" || answer === "project" || answer === "a" || answer === "always") {
      if (command) await allowCommand(command, "project");
      else await allowTool(tool.name, "project");
      return true;
    }
    if (answer === "g" || answer === "global") {
      if (command) await allowCommand(command, "global");
      else await allowTool(tool.name, "global");
      return true;
    }
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
