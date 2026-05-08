import type { Tool, ToolCall } from "./types.js";
import { truncate } from "./util.js";

export interface ToolUseRecord {
  call: ToolCall;
  args: unknown;
  result: string;
  tool?: Tool;
}

export function summarizeToolUse(records: ToolUseRecord[]): string {
  if (records.length === 0) return "";
  const lines = records.map((record, index) => {
    const action = record.tool?.summarize?.(record.args, record.result) ?? record.call.function.name;
    return `${index + 1}. ${action}: ${truncate(record.result.replace(/\s+/g, " ").trim(), 240)}`;
  });
  return `Tool-use summary:\n${lines.join("\n")}`;
}
