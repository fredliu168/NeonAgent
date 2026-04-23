import { describe, it, expect, beforeEach } from "vitest";
import type { StorageLike } from "../src/shared/storage.js";
import {
  createSkill,
  listSkills,
  getSkillById,
  getSkillByName,
  executeSkill,
  updateSkill,
  deleteSkill,
  getAllSkills,
  importSkills,
  formatSkillsForPrompt,
  formatSkillForExecution,
  skillToMarkdown,
  skillsToMarkdown,
  parseSkillMarkdown,
  parseSkillsMarkdown
} from "../src/shared/agentSkills.js";

function makeStorage(): StorageLike {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return store.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    }
  };
}

describe("agentSkills", () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("creates a skill with steps", async () => {
    const skill = await createSkill(storage, "Login Flow", "Automated login", [
      "Navigate to login page",
      "Fill username",
      "Fill password",
      "Click submit"
    ], ["automation"]);

    expect(skill.id).toMatch(/^skill-/);
    expect(skill.name).toBe("Login Flow");
    expect(skill.description).toBe("Automated login");
    expect(skill.steps).toHaveLength(4);
    expect(skill.steps[0].instruction).toBe("Navigate to login page");
    expect(skill.version).toBe(1);
    expect(skill.usageCount).toBe(0);
    expect(skill.tags).toEqual(["automation"]);
  });

  it("rejects duplicate skill names", async () => {
    await createSkill(storage, "MySkill", "desc", ["step 1"]);
    await expect(
      createSkill(storage, "myskill", "another", ["step 2"])
    ).rejects.toThrow(/already exists/);
  });

  it("lists all skills", async () => {
    await createSkill(storage, "Skill A", "desc a", ["step 1"]);
    await createSkill(storage, "Skill B", "desc b", ["step 2"], ["tag1"]);
    const all = await getAllSkills(storage);
    expect(all).toHaveLength(2);
  });

  it("searches skills by keyword", async () => {
    await createSkill(storage, "Login", "auto login", ["step 1"], ["auth"]);
    await createSkill(storage, "Search", "search items", ["step 1"]);

    const results = await listSkills(storage, "login");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Login");
  });

  it("searches skills by tag", async () => {
    await createSkill(storage, "Login", "auto login", ["step 1"], ["auth"]);
    await createSkill(storage, "Search", "search items", ["step 1"]);

    const results = await listSkills(storage, "auth");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Login");
  });

  it("returns all skills when query is empty", async () => {
    await createSkill(storage, "A", "a", ["s1"]);
    await createSkill(storage, "B", "b", ["s2"]);
    const results = await listSkills(storage, "");
    expect(results).toHaveLength(2);
  });

  it("gets skill by id", async () => {
    const skill = await createSkill(storage, "Test", "test desc", ["step"]);
    const found = await getSkillById(storage, skill.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Test");
  });

  it("gets skill by name", async () => {
    await createSkill(storage, "Test", "test desc", ["step"]);
    const found = await getSkillByName(storage, "test");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Test");
  });

  it("returns undefined for unknown skill id", async () => {
    const found = await getSkillById(storage, "nonexistent");
    expect(found).toBeUndefined();
  });

  it("executes a skill and increments usage count", async () => {
    const skill = await createSkill(storage, "Test", "desc", ["step 1", "step 2"]);
    expect(skill.usageCount).toBe(0);

    const executed = await executeSkill(storage, skill.id);
    expect(executed.usageCount).toBe(1);
    expect(executed.lastUsedAt).toBeGreaterThan(0);

    const executed2 = await executeSkill(storage, skill.id);
    expect(executed2.usageCount).toBe(2);
  });

  it("throws when executing unknown skill", async () => {
    await expect(executeSkill(storage, "nonexistent")).rejects.toThrow(/not found/);
  });

  it("updates a skill and increments version", async () => {
    const skill = await createSkill(storage, "Test", "old desc", ["old step"]);
    expect(skill.version).toBe(1);

    const updated = await updateSkill(storage, skill.id, {
      description: "new desc",
      steps: ["new step 1", "new step 2"]
    });

    expect(updated.version).toBe(2);
    expect(updated.description).toBe("new desc");
    expect(updated.steps).toHaveLength(2);
    expect(updated.steps[0].instruction).toBe("new step 1");
    expect(updated.name).toBe("Test"); // unchanged
  });

  it("rejects update with duplicate name", async () => {
    await createSkill(storage, "A", "a", ["s"]);
    const b = await createSkill(storage, "B", "b", ["s"]);
    await expect(updateSkill(storage, b.id, { name: "A" })).rejects.toThrow(/already exists/);
  });

  it("throws when updating unknown skill", async () => {
    await expect(updateSkill(storage, "nonexistent", { description: "x" })).rejects.toThrow(/not found/);
  });

  it("deletes a skill", async () => {
    const skill = await createSkill(storage, "Test", "desc", ["step"]);
    const deleted = await deleteSkill(storage, skill.id);
    expect(deleted).toBe(true);
    const all = await getAllSkills(storage);
    expect(all).toHaveLength(0);
  });

  it("returns false when deleting unknown skill", async () => {
    const deleted = await deleteSkill(storage, "nonexistent");
    expect(deleted).toBe(false);
  });

  it("formatSkillsForPrompt returns empty for no skills", () => {
    expect(formatSkillsForPrompt([])).toBe("");
  });

  it("formatSkillsForPrompt formats skill summaries", async () => {
    await createSkill(storage, "Login", "auto login", ["step 1"], ["auth"]);
    const skills = await getAllSkills(storage);
    const prompt = formatSkillsForPrompt(skills);
    expect(prompt).toContain("已保存的技能");
    expect(prompt).toContain("Login");
    expect(prompt).toContain("auto login");
    expect(prompt).toContain("[auth]");
  });

  it("formatSkillForExecution formats step-by-step playbook", async () => {
    const skill = await createSkill(storage, "Login", "auto login", [
      "Navigate to login page",
      "Fill username",
      "Click submit"
    ]);
    const playbook = formatSkillForExecution(skill);
    expect(playbook).toContain("Login");
    expect(playbook).toContain("1. Navigate to login page");
    expect(playbook).toContain("2. Fill username");
    expect(playbook).toContain("3. Click submit");
  });

  // ── importSkills ──

  it("imports skills from an array", async () => {
    const result = await importSkills(storage, [
      { name: "Skill A", description: "desc A", steps: ["step 1", "step 2"], tags: ["tag1"] },
      { name: "Skill B", description: "desc B", steps: ["step 3"] }
    ]);
    expect(result.imported).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    const all = await getAllSkills(storage);
    expect(all).toHaveLength(2);
  });

  it("skips skills with duplicate names during import", async () => {
    await createSkill(storage, "Existing", "already here", ["step 1"]);
    const result = await importSkills(storage, [
      { name: "Existing", description: "dup", steps: ["step x"] },
      { name: "New One", description: "fresh", steps: ["step y"] }
    ]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].name).toBe("New One");
    expect(result.skipped).toEqual(["Existing"]);
  });

  it("skips skills with empty name or no steps", async () => {
    const result = await importSkills(storage, [
      { name: "", description: "no name", steps: ["step1"] },
      { name: "No Steps", description: "desc", steps: [] }
    ]);
    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
  });

  it("handles SkillStep objects in import data", async () => {
    const result = await importSkills(storage, [
      { name: "ObjSteps", description: "d", steps: [{ instruction: "do thing" }] as unknown as string[] }
    ]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].steps[0].instruction).toBe("do thing");
  });

  // ── Markdown serialization / deserialization ──

  it("skillToMarkdown serializes a skill to Markdown", () => {
    const md = skillToMarkdown({
      name: "Login Flow",
      description: "Automated login procedure",
      steps: ["Navigate to login page", "Fill username", "Click submit"],
      tags: ["automation", "auth"]
    });
    expect(md).toContain("# Login Flow");
    expect(md).toContain("Automated login procedure");
    expect(md).toContain("## Steps");
    expect(md).toContain("1. Navigate to login page");
    expect(md).toContain("2. Fill username");
    expect(md).toContain("3. Click submit");
    expect(md).toContain("## Tags");
    expect(md).toContain("automation, auth");
  });

  it("skillToMarkdown omits Tags section when empty", () => {
    const md = skillToMarkdown({
      name: "Simple",
      description: "desc",
      steps: ["step 1"],
      tags: []
    });
    expect(md).not.toContain("## Tags");
  });

  it("skillToMarkdown handles SkillStep objects", () => {
    const md = skillToMarkdown({
      name: "Test",
      description: "d",
      steps: [{ instruction: "do thing" }]
    });
    expect(md).toContain("1. do thing");
  });

  it("parseSkillMarkdown parses a valid Markdown skill", () => {
    const md = `# Login Flow

Automated login procedure

## Steps

1. Navigate to login page
2. Fill username
3. Click submit

## Tags

automation, auth`;
    const parsed = parseSkillMarkdown(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("Login Flow");
    expect(parsed!.description).toBe("Automated login procedure");
    expect(parsed!.steps).toEqual(["Navigate to login page", "Fill username", "Click submit"]);
    expect(parsed!.tags).toEqual(["automation", "auth"]);
  });

  it("parseSkillMarkdown returns null for empty input", () => {
    expect(parseSkillMarkdown("")).toBeNull();
    expect(parseSkillMarkdown("   ")).toBeNull();
  });

  it("parseSkillMarkdown returns null when no H1", () => {
    expect(parseSkillMarkdown("Just some text\n## Steps\n1. step")).toBeNull();
  });

  it("parseSkillMarkdown returns null when no steps", () => {
    expect(parseSkillMarkdown("# Name\n\nDescription only")).toBeNull();
  });

  it("parseSkillMarkdown handles missing Tags section", () => {
    const md = `# Quick Task

Do something fast

## Steps

1. Do it`;
    const parsed = parseSkillMarkdown(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("Quick Task");
    expect(parsed!.tags).toEqual([]);
  });

  it("parseSkillMarkdown handles multi-line description", () => {
    const md = `# My Skill

First line of description.
Second line of description.

## Steps

1. Step one`;
    const parsed = parseSkillMarkdown(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.description).toBe("First line of description.\nSecond line of description.");
  });

  it("skillsToMarkdown joins multiple skills with ---", () => {
    const md = skillsToMarkdown([
      { name: "A", description: "desc A", steps: ["s1"], tags: ["t1"] },
      { name: "B", description: "desc B", steps: ["s2"] }
    ]);
    expect(md).toContain("# A");
    expect(md).toContain("# B");
    expect(md).toContain("---");
  });

  it("parseSkillsMarkdown parses multiple skills", () => {
    const md = `# Skill A

Description A

## Steps

1. Step A1
2. Step A2

## Tags

tagA

---

# Skill B

Description B

## Steps

1. Step B1`;
    const skills = parseSkillsMarkdown(md);
    expect(skills).toHaveLength(2);
    expect(skills[0].name).toBe("Skill A");
    expect(skills[0].steps).toEqual(["Step A1", "Step A2"]);
    expect(skills[0].tags).toEqual(["tagA"]);
    expect(skills[1].name).toBe("Skill B");
    expect(skills[1].steps).toEqual(["Step B1"]);
    expect(skills[1].tags).toEqual([]);
  });

  it("roundtrip: skillToMarkdown -> parseSkillMarkdown preserves data", () => {
    const original = {
      name: "Roundtrip Test",
      description: "Test roundtrip fidelity",
      steps: ["First step", "Second step", "Third step"],
      tags: ["test", "roundtrip"]
    };
    const md = skillToMarkdown(original);
    const parsed = parseSkillMarkdown(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe(original.name);
    expect(parsed!.description).toBe(original.description);
    expect(parsed!.steps).toEqual(original.steps);
    expect(parsed!.tags).toEqual(original.tags);
  });

  it("roundtrip: skillsToMarkdown -> parseSkillsMarkdown preserves multiple skills", () => {
    const originals = [
      { name: "Skill X", description: "X desc", steps: ["x1", "x2"], tags: ["a"] },
      { name: "Skill Y", description: "Y desc", steps: ["y1"], tags: [] }
    ];
    const md = skillsToMarkdown(originals);
    const parsed = parseSkillsMarkdown(md);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("Skill X");
    expect(parsed[0].steps).toEqual(["x1", "x2"]);
    expect(parsed[1].name).toBe("Skill Y");
    expect(parsed[1].steps).toEqual(["y1"]);
  });
});
