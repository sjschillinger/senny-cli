export type CommandRisk = "read" | "write" | "network" | "dangerous";

const readOnlyCommands = new Set([
  "ls",
  "pwd",
  "rg",
  "grep",
  "find",
  "cat",
  "sed",
  "awk",
  "head",
  "tail",
  "wc",
  "git",
  "npm",
  "node"
]);

const writeVerbs = /\b(rm|mv|cp|mkdir|touch|chmod|chown|tee|truncate|npm\s+(install|i|update|remove|uninstall)|pnpm\s+(add|install|remove)|yarn\s+(add|install|remove)|git\s+(commit|push|pull|merge|rebase|checkout|switch|reset|clean|apply|am)|go\s+mod\s+tidy)\b/;
const networkVerbs = /\b(curl|wget|ssh|scp|rsync|nc|netcat)\b/;
const dangerousPatterns = /\b(sudo|su|dd|mkfs|diskutil|shutdown|reboot)\b|>\s*\/|rm\s+(-[^\s]*r[^\s]*f|- [^\n]*-r[^\n]*-f)|\|\s*(sh|bash|zsh)\b/;
const writeOperators = /(^|[^>])>([^>]|$)|>>|\btee\b/;

export interface CommandAnalysis {
  risk: CommandRisk;
  reason: string;
}

export function analyzeCommand(command: string): CommandAnalysis {
  const normalized = command.trim();
  if (!normalized) return { risk: "read", reason: "empty command" };
  if (dangerousPatterns.test(normalized)) return { risk: "dangerous", reason: "contains destructive shell pattern" };
  if (/\bcd\b/.test(normalized)) return { risk: "dangerous", reason: "changes working directory" };
  if (networkVerbs.test(normalized)) return { risk: "network", reason: "uses network-capable command" };
  if (writeVerbs.test(normalized) || writeOperators.test(normalized)) return { risk: "write", reason: "appears to mutate files or repository state" };

  const first = normalized.split(/\s+/)[0] ?? "";
  if (readOnlyCommands.has(first)) return { risk: "read", reason: "known read-only command" };
  return { risk: "write", reason: "unknown command requires approval" };
}

export function isAutoApprovableCommand(command: string): boolean {
  const analysis = analyzeCommand(command);
  return analysis.risk === "read";
}

export function analyzeParsedShell(command: string, hasWriteRedirect: boolean, parseOK: boolean): CommandAnalysis {
  if (!parseOK) return { risk: "dangerous", reason: "shell parser rejected the command" };
  if (hasWriteRedirect) return { risk: "write", reason: "shell AST contains an output redirect" };
  return analyzeCommand(command);
}
