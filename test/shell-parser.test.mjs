import test from "node:test";
import assert from "node:assert/strict";
import { hasDangerousRedirect, parseShellFacts } from "../dist/shell-parser.js";
import { analyzeParsedShell } from "../dist/safety.js";

test("sh-syntax parser detects write redirects", async () => {
  const facts = await parseShellFacts("echo hi > file.txt");
  assert.equal(facts.parseOK, true);
  assert.equal(hasDangerousRedirect(facts), true);
  assert.equal(analyzeParsedShell("echo hi > file.txt", hasDangerousRedirect(facts), facts.parseOK).risk, "write");
});

test("sh-syntax parser accepts chained commands", async () => {
  const facts = await parseShellFacts("go mod tidy && go test -v ./...");
  assert.equal(facts.parseOK, true);
  assert.equal(facts.hasRedirect, false);
});
