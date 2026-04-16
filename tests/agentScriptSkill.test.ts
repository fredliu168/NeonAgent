import { describe, it, expect, beforeEach, vi } from "vitest";
import type { StorageLike } from "../src/shared/storage.js";
import {
  createScriptSkill,
  getAllScriptSkills,
  getScriptSkillById,
  getScriptSkillByName,
  updateScriptSkill,
  deleteScriptSkill,
  listScriptSkills,
  findScriptSkillByToolName,
  executeScriptSkillTool,
  recordScriptSkillUsage,
  validateScriptCode,
  generateScriptSkillToolDefs,
  getScriptSkillToolNames,
  formatScriptSkillsForPrompt,
  parseSkillMd
} from "../src/shared/agentScriptSkill.js";
import type { ScriptSkill, ScriptSkillToolDef } from "../src/shared/agentScriptSkill.js";

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

const sampleTool: ScriptSkillToolDef = {
  name: "greet",
  description: "Return a greeting",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name to greet" }
    },
    required: ["name"],
    additionalProperties: false
  }
};

const sampleCode = `
exports.greet = async function(args) {
  return "Hello, " + (args.name || "world") + "!";
};
`;

describe("agentScriptSkill", () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = makeStorage();
  });

  // ── CRUD ──

  it("creates a script skill", async () => {
    const skill = await createScriptSkill(storage, {
      name: "Greeter",
      description: "A greeting skill",
      code: sampleCode,
      tools: [sampleTool],
      tags: ["demo"]
    });

    expect(skill.id).toMatch(/^sskill-/);
    expect(skill.name).toBe("Greeter");
    expect(skill.tools).toHaveLength(1);
    expect(skill.tools[0].name).toBe("greet");
    expect(skill.version).toBe(1);
    expect(skill.usageCount).toBe(0);
  });

  it("rejects duplicate skill names", async () => {
    await createScriptSkill(storage, {
      name: "Greeter",
      description: "d",
      code: sampleCode,
      tools: [sampleTool]
    });
    await expect(
      createScriptSkill(storage, {
        name: "greeter",
        description: "d",
        code: sampleCode,
        tools: [{ ...sampleTool, name: "greet2" }]
      })
    ).rejects.toThrow(/already exists/);
  });

  it("rejects duplicate tool names across skills", async () => {
    await createScriptSkill(storage, {
      name: "A",
      description: "d",
      code: sampleCode,
      tools: [sampleTool]
    });
    await expect(
      createScriptSkill(storage, {
        name: "B",
        description: "d",
        code: sampleCode,
        tools: [sampleTool] // same tool name "greet"
      })
    ).rejects.toThrow(/already exists/);
  });

  it("rejects empty name or code", async () => {
    await expect(
      createScriptSkill(storage, { name: "", description: "d", code: sampleCode, tools: [sampleTool] })
    ).rejects.toThrow(/name is required/);
    await expect(
      createScriptSkill(storage, { name: "X", description: "d", code: "", tools: [sampleTool] })
    ).rejects.toThrow(/code is required/);
    await expect(
      createScriptSkill(storage, { name: "X", description: "d", code: sampleCode, tools: [] })
    ).rejects.toThrow(/At least one tool/);
  });

  it("lists all script skills", async () => {
    await createScriptSkill(storage, { name: "A", description: "a", code: sampleCode, tools: [{ ...sampleTool, name: "tool_a" }] });
    await createScriptSkill(storage, { name: "B", description: "b", code: sampleCode, tools: [{ ...sampleTool, name: "tool_b" }] });
    const all = await getAllScriptSkills(storage);
    expect(all).toHaveLength(2);
  });

  it("gets skill by id", async () => {
    const skill = await createScriptSkill(storage, { name: "A", description: "d", code: sampleCode, tools: [sampleTool] });
    const found = await getScriptSkillById(storage, skill.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("A");
  });

  it("gets skill by name (case insensitive)", async () => {
    await createScriptSkill(storage, { name: "Weather", description: "d", code: sampleCode, tools: [sampleTool] });
    const found = await getScriptSkillByName(storage, "weather");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Weather");
  });

  it("finds skill by tool name", async () => {
    await createScriptSkill(storage, { name: "A", description: "d", code: sampleCode, tools: [sampleTool] });
    const found = await findScriptSkillByToolName(storage, "greet");
    expect(found).toBeDefined();
    expect(found!.name).toBe("A");
  });

  it("returns undefined for unknown tool name", async () => {
    const found = await findScriptSkillByToolName(storage, "nonexistent");
    expect(found).toBeUndefined();
  });

  it("updates a script skill", async () => {
    const skill = await createScriptSkill(storage, { name: "A", description: "old", code: sampleCode, tools: [sampleTool] });
    const updated = await updateScriptSkill(storage, skill.id, { description: "new desc" });
    expect(updated.description).toBe("new desc");
    expect(updated.version).toBe(2);
    expect(updated.name).toBe("A");
  });

  it("deletes a script skill", async () => {
    const skill = await createScriptSkill(storage, { name: "A", description: "d", code: sampleCode, tools: [sampleTool] });
    const deleted = await deleteScriptSkill(storage, skill.id);
    expect(deleted).toBe(true);
    const all = await getAllScriptSkills(storage);
    expect(all).toHaveLength(0);
  });

  it("returns false deleting unknown skill", async () => {
    expect(await deleteScriptSkill(storage, "nonexistent")).toBe(false);
  });

  it("records usage", async () => {
    const skill = await createScriptSkill(storage, { name: "A", description: "d", code: sampleCode, tools: [sampleTool] });
    await recordScriptSkillUsage(storage, skill.id);
    const found = await getScriptSkillById(storage, skill.id);
    expect(found!.usageCount).toBe(1);
    expect(found!.lastUsedAt).toBeGreaterThan(0);
  });

  // ── Search ──

  it("searches by keyword", async () => {
    await createScriptSkill(storage, { name: "Weather", description: "Get weather data", code: sampleCode, tools: [{ ...sampleTool, name: "get_weather" }], tags: ["api"] });
    await createScriptSkill(storage, { name: "Calculator", description: "Math ops", code: sampleCode, tools: [{ ...sampleTool, name: "calc" }] });

    const results = await listScriptSkills(storage, "weather");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Weather");
  });

  it("returns all when query is empty", async () => {
    await createScriptSkill(storage, { name: "A", description: "d", code: sampleCode, tools: [{ ...sampleTool, name: "ta" }] });
    await createScriptSkill(storage, { name: "B", description: "d", code: sampleCode, tools: [{ ...sampleTool, name: "tb" }] });
    const results = await listScriptSkills(storage, "");
    expect(results).toHaveLength(2);
  });

  // ── Validation ──

  it("validateScriptCode accepts valid code", () => {
    expect(() => validateScriptCode(sampleCode)).not.toThrow();
  });

  it("validateScriptCode rejects empty code", () => {
    expect(() => validateScriptCode("")).toThrow(/cannot be empty/);
  });

  it("validateScriptCode rejects eval", () => {
    expect(() => validateScriptCode("eval('alert(1)')")).toThrow(/disallowed pattern/);
  });

  it("validateScriptCode rejects new Function", () => {
    expect(() => validateScriptCode("new Function('return 1')")).toThrow(/disallowed pattern/);
  });

  it("validateScriptCode rejects code without exports", () => {
    expect(() => validateScriptCode("function doSomething() { return 1; }")).toThrow(/exports/);
  });

  // ── Execution ──

  it("executes a script skill tool", async () => {
    const skill = await createScriptSkill(storage, {
      name: "Greeter",
      description: "d",
      code: sampleCode,
      tools: [sampleTool]
    });

    const result = await executeScriptSkillTool(skill, "greet", { name: "Alice" });
    expect(result).toBe("Hello, Alice!");
  });

  it("executes with default args", async () => {
    const skill = await createScriptSkill(storage, {
      name: "Greeter",
      description: "d",
      code: sampleCode,
      tools: [sampleTool]
    });

    const result = await executeScriptSkillTool(skill, "greet", {});
    expect(result).toBe("Hello, world!");
  });

  it("executes tool that returns object", async () => {
    const code = `
exports.get_data = async function(args) {
  return { temp: 25, city: args.city || "Beijing" };
};
`;
    const skill = await createScriptSkill(storage, {
      name: "DataSkill",
      description: "d",
      code,
      tools: [{ name: "get_data", description: "Get data", parameters: { type: "object", properties: {}, required: [] } }]
    });

    const result = await executeScriptSkillTool(skill, "get_data", { city: "Shanghai" });
    const parsed = JSON.parse(result);
    expect(parsed.temp).toBe(25);
    expect(parsed.city).toBe("Shanghai");
  });

  it("provides env vars to the script", async () => {
    const code = `
exports.check_env = async function(args, env) {
  return "key=" + (env.MY_KEY || "none");
};
`;
    const skill = await createScriptSkill(storage, {
      name: "EnvSkill",
      description: "d",
      code,
      tools: [{ name: "check_env", description: "Check env", parameters: { type: "object", properties: {}, required: [] } }],
      envVars: { MY_KEY: "secret123" }
    });

    const result = await executeScriptSkillTool(skill, "check_env", {});
    expect(result).toBe("key=secret123");
  });

  it("captures console output", async () => {
    const code = `
exports.logged = async function() {
  console.log("debug info");
  return "ok";
};
`;
    const skill = await createScriptSkill(storage, {
      name: "LogSkill",
      description: "d",
      code,
      tools: [{ name: "logged", description: "Log", parameters: { type: "object", properties: {}, required: [] } }]
    });

    const result = await executeScriptSkillTool(skill, "logged", {});
    expect(result).toContain("ok");
    expect(result).toContain("debug info");
  });

  it("throws when tool not found in skill", async () => {
    const skill = await createScriptSkill(storage, {
      name: "A",
      description: "d",
      code: sampleCode,
      tools: [sampleTool]
    });

    await expect(
      executeScriptSkillTool(skill, "nonexistent", {})
    ).rejects.toThrow(/not found/);
  });

  it("throws when handler function not exported", async () => {
    const code = `
exports.wrong_name = async function() { return "x"; };
`;
    const skill: ScriptSkill = {
      id: "test",
      name: "Test",
      description: "d",
      code,
      tools: [{ name: "right_name", description: "d", parameters: { type: "object", properties: {} } }],
      envVars: {},
      tags: [],
      version: 1,
      createdAt: 0,
      updatedAt: 0,
      usageCount: 0,
      lastUsedAt: null
    };

    await expect(
      executeScriptSkillTool(skill, "right_name", {})
    ).rejects.toThrow(/does not export/);
  });

  it("handles script runtime errors", async () => {
    const code = `
exports.broken = async function() {
  throw new Error("oops");
};
`;
    const skill = await createScriptSkill(storage, {
      name: "BrokenSkill",
      description: "d",
      code,
      tools: [{ name: "broken", description: "Broken", parameters: { type: "object", properties: {}, required: [] } }]
    });

    await expect(
      executeScriptSkillTool(skill, "broken", {})
    ).rejects.toThrow("oops");
  });

  it("uses custom fetcher", async () => {
    const code = `
exports.fetch_data = async function(args) {
  const resp = await fetch("https://example.com/api");
  const text = await resp.text();
  return text;
};
`;
    const mockFetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve("mock response"),
      ok: true,
      status: 200
    });

    const skill = await createScriptSkill(storage, {
      name: "FetchSkill",
      description: "d",
      code,
      tools: [{ name: "fetch_data", description: "Fetch", parameters: { type: "object", properties: {}, required: [] } }]
    });

    const result = await executeScriptSkillTool(skill, "fetch_data", {}, mockFetch as unknown as typeof fetch);
    expect(result).toBe("mock response");
    expect(mockFetch).toHaveBeenCalled();
  });

  // ── Tool Definition Generation ──

  it("generates tool definitions from script skills", async () => {
    const skill = await createScriptSkill(storage, {
      name: "Greeter",
      description: "d",
      code: sampleCode,
      tools: [sampleTool]
    });
    const skills = await getAllScriptSkills(storage);
    const defs = generateScriptSkillToolDefs(skills);
    expect(defs).toHaveLength(1);
    expect(defs[0].type).toBe("function");
    expect(defs[0].function.name).toBe("greet");
    expect(defs[0].function.description).toContain("Greeter");
  });

  it("collects tool names", async () => {
    await createScriptSkill(storage, {
      name: "A",
      description: "d",
      code: sampleCode,
      tools: [sampleTool]
    });
    const skills = await getAllScriptSkills(storage);
    const names = getScriptSkillToolNames(skills);
    expect(names.has("greet")).toBe(true);
  });

  // ── Prompt Formatting ──

  it("formats empty script skills", () => {
    expect(formatScriptSkillsForPrompt([])).toBe("");
  });

  it("formats script skills for prompt", async () => {
    await createScriptSkill(storage, {
      name: "Weather",
      description: "Get weather data",
      code: sampleCode,
      tools: [{ ...sampleTool, name: "get_weather" }],
      sourceUrl: "https://clawhub.ai/test/weather",
      tags: ["api"]
    });
    const skills = await getAllScriptSkills(storage);
    const prompt = formatScriptSkillsForPrompt(skills);
    expect(prompt).toContain("已安装的脚本技能");
    expect(prompt).toContain("Weather");
    expect(prompt).toContain("get_weather");
    expect(prompt).toContain("clawhub.ai");
  });

  // ── SKILL.md Parsing ──

  it("parses SKILL.md with frontmatter", () => {
    const md = `---
name: weather-pollen
description: Weather and pollen reports for any location.
version: 1.0.3
---

# Weather and Pollen Skill

Get weather and pollen reports for any location using free APIs.

## Tools

### weather_report

Get weather and pollen data for a specified location.

Args:

\`includePollen\` (boolean, default: true) - Include pollen data
\`location\` (string, optional) - Location name to display

## Configuration

Set location via environment variables:

\`WEATHER_LAT\` - Latitude (default: 33.3506)
\`WEATHER_LON\` - Longitude (default: -96.3175)
\`WEATHER_LOCATION\` - Location display name
`;
    const parsed = parseSkillMd(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("weather-pollen");
    expect(parsed!.description).toBe("Weather and pollen reports for any location.");
    expect(parsed!.tools).toHaveLength(1);
    expect(parsed!.tools[0].name).toBe("weather_report");
    expect(parsed!.envVars).toContain("WEATHER_LAT");
    expect(parsed!.envVars).toContain("WEATHER_LON");
    expect(parsed!.envVars).toContain("WEATHER_LOCATION");
  });

  it("parses SKILL.md with H1 name fallback", () => {
    const md = `# My Cool Skill

A nice description.

## Tools

### do_thing

Does the thing.

Args:

\`input\` (string) - The input text
`;
    const parsed = parseSkillMd(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("My Cool Skill");
    expect(parsed!.tools).toHaveLength(1);
    expect(parsed!.tools[0].name).toBe("do_thing");
  });

  it("returns null for empty input", () => {
    expect(parseSkillMd("")).toBeNull();
  });
});
