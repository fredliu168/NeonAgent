import { describe, it, expect } from "vitest";
import { buildAgentSystemPrompt } from "../src/shared/agentSystemPrompt.js";

describe("agentSystemPrompt", () => {
  it("builds a system prompt without context", () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain("浏览器智能体");
    expect(prompt).toContain("系统规则");
    expect(prompt).toContain("执行任务的原则");
    expect(prompt).toContain("安全守则");
  });

  it("includes page context when provided", () => {
    const prompt = buildAgentSystemPrompt({
      pageUrl: "https://example.com",
      pageTitle: "Example Page"
    });
    expect(prompt).toContain("https://example.com");
    expect(prompt).toContain("Example Page");
    expect(prompt).toContain("当前环境");
  });

  it("omits environment section when no context", () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).not.toContain("当前环境");
  });
});
