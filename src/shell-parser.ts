import { parse } from "sh-syntax";

export interface ShellCommandFacts {
  parseOK: boolean;
  parseError?: string;
  hasRedirect: boolean;
  redirectOps: string[];
  commandSpans: string[];
}

export async function parseShellFacts(command: string): Promise<ShellCommandFacts> {
  try {
    const ast = await parse(command, { variant: 0 });
    const stmts = Array.isArray((ast as unknown as { Stmt?: unknown[] }).Stmt)
      ? ((ast as unknown as { Stmt: ShStmt[] }).Stmt)
      : Array.isArray((ast as unknown as { Stmts?: unknown[] }).Stmts)
        ? ((ast as unknown as { Stmts: ShStmt[] }).Stmts)
        : [];

    const redirectOps = stmts.flatMap((stmt) => (stmt.Redirs ?? []).map((redir) => redir.Op));
    const commandSpans = stmts
      .map((stmt) => sliceByOffset(command, stmt.Cmd?.Pos?.Offset ?? stmt.Pos?.Offset, stmt.Cmd?.End?.Offset ?? stmt.End?.Offset))
      .filter(Boolean);
    return {
      parseOK: true,
      hasRedirect: redirectOps.length > 0,
      redirectOps,
      commandSpans
    };
  } catch (err) {
    return {
      parseOK: false,
      parseError: (err as Error).message,
      hasRedirect: false,
      redirectOps: [],
      commandSpans: []
    };
  }
}

export function hasDangerousRedirect(facts: ShellCommandFacts): boolean {
  return facts.redirectOps.some((op) => [">", ">|", ">>", "<>", "&>", "&>>"].includes(op));
}

interface ShPos {
  Offset: number;
}

interface ShNode {
  Pos?: ShPos;
  End?: ShPos;
}

interface ShRedirect {
  Op: string;
}

interface ShStmt extends ShNode {
  Cmd?: ShNode | null;
  Redirs?: ShRedirect[];
}

function sliceByOffset(source: string, start?: number, end?: number): string {
  if (typeof start !== "number" || typeof end !== "number" || end <= start) return "";
  return source.slice(start, end).trim();
}
