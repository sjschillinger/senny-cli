import type { ChatMessage } from "./types.js";
import { truncate } from "./util.js";

export function compactHistory(history: ChatMessage[]): { note: string; history: ChatMessage[] } {
  if (history.length <= 10) {
    return { note: "", history };
  }

  const keep = history.slice(-8);
  const older = history.slice(0, -8);
  const userGoals = older
    .filter((msg) => msg.role === "user")
    .slice(-6)
    .map((msg) => `- User asked: ${oneLine(msg.content, 220)}`);
  const toolFacts = older
    .filter((msg) => msg.role === "tool")
    .slice(-12)
    .map((msg) => `- Tool returned: ${oneLine(msg.content, 180)}`);
  const assistantDecisions = older
    .filter((msg) => msg.role === "assistant" && msg.content.trim())
    .slice(-6)
    .map((msg) => `- Assistant noted: ${oneLine(msg.content, 220)}`);

  const note = [
    "# Compacted Prior Conversation",
    "The following is a deterministic summary of older turns. Preserve these constraints and facts, but prefer the live recent messages for exact wording.",
    ...userGoals,
    ...assistantDecisions,
    ...toolFacts
  ].join("\n");

  return { note: truncate(note, 8000), history: keep };
}

function oneLine(value: string, max: number): string {
  return truncate(value.replace(/\s+/g, " ").trim(), max);
}
