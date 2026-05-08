import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { discoverSkills, parseSkillFile, registerActivateSkillTool } from "../dist/skills.js";
import { ToolRegistry } from "../dist/tools/registry.js";

test("parseSkillFile reads frontmatter and body", () => {
  const parsed = parseSkillFile("---\nname: demo\ndescription: Demo skill\n---\nUse care.\n");
  assert.equal(parsed.metadata.name, "demo");
  assert.equal(parsed.instructions ?? parsed.body, "Use care.\n");
});

test("discoverSkills and activate_skill register script tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "senny-skills-"));
  try {
    const skillDir = path.join(root, "demo");
    await mkdir(path.join(skillDir, "scripts"), { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\nInstructions here.\n");
    await writeFile(path.join(skillDir, "scripts", "hello.js"), "console.log('hello ' + process.argv[2])\n");
    const skills = await discoverSkills([root]);
    assert.equal(skills.length, 1);
    const registry = new ToolRegistry();
    registerActivateSkillTool(registry, skills);
    const activate = registry.get("activate_skill");
    assert.ok(activate);
    const result = await activate.run({ name: "demo" }, { cwd: root, unsafe: true });
    assert.match(result, /Instructions here/);
    const script = registry.get("skill_demo_hello_js");
    assert.ok(script);
    assert.equal(await script.run({ args: ["world"] }, { cwd: root, unsafe: true }), "hello world");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
