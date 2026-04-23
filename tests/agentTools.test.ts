import { describe, it, expect } from "vitest";
import { AGENT_TOOL_DEFINITIONS, getToolByName, PAGE_TOOLS, BACKGROUND_TOOLS } from "../src/shared/agentTools.js";

describe("agentTools", () => {
  it("defines at least 10 browser tools", () => {
    expect(AGENT_TOOL_DEFINITIONS.length).toBeGreaterThanOrEqual(10);
  });

  it("each tool has required fields", () => {
    for (const tool of AGENT_TOOL_DEFINITIONS) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.description).toBeTruthy();
      expect(tool.function.parameters).toBeTruthy();
      expect(tool.function.parameters.type).toBe("object");
    }
  });

  it("getToolByName returns correct tool", () => {
    const tool = getToolByName("get_page_info");
    expect(tool).toBeDefined();
    expect(tool!.function.name).toBe("get_page_info");
  });

  it("getToolByName returns undefined for unknown tool", () => {
    expect(getToolByName("nonexistent_tool")).toBeUndefined();
  });

  it("all tools are categorized as PAGE or BACKGROUND", () => {
    for (const tool of AGENT_TOOL_DEFINITIONS) {
      const name = tool.function.name;
      const inPage = PAGE_TOOLS.has(name);
      const inBg = BACKGROUND_TOOLS.has(name);
      expect(inPage || inBg).toBe(true);
    }
  });

  it("navigate is a background tool", () => {
    expect(BACKGROUND_TOOLS.has("navigate")).toBe(true);
    expect(PAGE_TOOLS.has("navigate")).toBe(false);
  });
});
