import { describe, it, expect, vi } from "vitest";
import { runAgentLoop } from "../src/shared/agentLoop.js";
import type { AgentProgressEvent, AgentRunConfig, ToolResult } from "../src/shared/agentTypes.js";

function makeMockConfig(overrides?: Partial<AgentRunConfig>): AgentRunConfig {
  return {
    requestId: "test-req-1",
    tabId: 1,
    config: {
      baseUrl: "http://localhost/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      models: ["test-model"],
      temperature: 0.2,
      maxTokens: 4096,
      systemPrompt: "",
      unlockContextMenu: false,
      blockVisibilityDetection: false,
      aggressiveVisibilityBypass: false,
      enableFloatingBall: false
    },
    userMessage: "Help me with this page",
    maxIterations: 3,
    ...overrides
  };
}

function mockStreamResponse(
  body: string
): { ok: boolean; status: number; body: ReadableStream; text: () => Promise<string> } {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    }
  });
  return {
    ok: true,
    status: 200,
    body: stream,
    text: async () => body
  };
}

describe("agentLoop", () => {
  it("completes when LLM responds with text only (no tool calls)", async () => {
    const events: AgentProgressEvent[] = [];

    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"content":"world!"},"finish_reason":"stop"}]}',
      "data: [DONE]"
    ].join("\n");

    const fetcher = vi.fn().mockResolvedValue(mockStreamResponse(sseBody));

    await runAgentLoop(
      makeMockConfig(),
      {
        emit: (e) => { events.push(e); },
        executePageTool: vi.fn(),
        executeBackgroundTool: vi.fn(),
        fetcher: fetcher as unknown as typeof fetch
      }
    );

    const textDeltas = events.filter((e) => e.type === "AGENT_TEXT_DELTA");
    expect(textDeltas.length).toBe(2);
    expect(textDeltas[0].payload).toEqual({ requestId: "test-req-1", delta: "Hello " });
    expect(textDeltas[1].payload).toEqual({ requestId: "test-req-1", delta: "world!" });

    const complete = events.find((e) => e.type === "AGENT_TURN_COMPLETE");
    expect(complete).toBeDefined();
    expect((complete as { payload: { iterations: number } }).payload.iterations).toBe(1);
  });

  it("executes tool calls and loops until no more tools", async () => {
    const events: AgentProgressEvent[] = [];
    let callCount = 0;

    // First LLM call returns a tool call
    const sseWithToolCall = [
      'data: {"choices":[{"delta":{"content":"Let me check. "},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_page_info","arguments":""}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"finish_reason":null}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]"
    ].join("\n");

    // Second LLM call returns text only
    const sseTextOnly = [
      'data: {"choices":[{"delta":{"content":"The page is ready."},"finish_reason":"stop"}]}',
      "data: [DONE]"
    ].join("\n");

    const fetcher = vi.fn().mockImplementation(async () => {
      callCount++;
      return mockStreamResponse(callCount === 1 ? sseWithToolCall : sseTextOnly);
    });

    const executePageTool = vi.fn().mockResolvedValue({
      toolCallId: "call_1",
      toolName: "get_page_info",
      output: '{"url":"https://example.com","title":"Test"}',
      isError: false
    } satisfies ToolResult);

    await runAgentLoop(
      makeMockConfig(),
      {
        emit: (e) => { events.push(e); },
        executePageTool,
        executeBackgroundTool: vi.fn(),
        fetcher: fetcher as unknown as typeof fetch
      }
    );

    // Should have called fetcher twice (tool loop)
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Should have executed the page tool
    expect(executePageTool).toHaveBeenCalledOnce();
    expect(executePageTool).toHaveBeenCalledWith(1, "get_page_info", {});

    // Should emit tool call and result
    const toolCalls = events.filter((e) => e.type === "AGENT_TOOL_CALL");
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);

    const toolResults = events.filter((e) => e.type === "AGENT_TOOL_RESULT");
    expect(toolResults.length).toBe(1);

    // Should complete
    const complete = events.find((e) => e.type === "AGENT_TURN_COMPLETE");
    expect(complete).toBeDefined();
    expect((complete as { payload: { iterations: number } }).payload.iterations).toBe(2);
  });

  it("stops at max iterations with error", async () => {
    const events: AgentProgressEvent[] = [];

    // Always return a tool call
    const sseToolCall = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_X","type":"function","function":{"name":"get_page_info","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
      "data: [DONE]"
    ].join("\n");

    const fetcher = vi.fn().mockImplementation(async () =>
      mockStreamResponse(sseToolCall)
    );

    await runAgentLoop(
      makeMockConfig({ maxIterations: 2 }),
      {
        emit: (e) => { events.push(e); },
        executePageTool: vi.fn().mockResolvedValue({
          toolCallId: "call_X",
          toolName: "get_page_info",
          output: "{}",
          isError: false
        }),
        executeBackgroundTool: vi.fn(),
        fetcher: fetcher as unknown as typeof fetch
      }
    );

    const error = events.find((e) => e.type === "AGENT_ERROR");
    expect(error).toBeDefined();
    expect((error as { payload: { error: string } }).payload.error).toContain("maximum iterations");
  });

  it("handles LLM request failure gracefully", async () => {
    const events: AgentProgressEvent[] = [];

    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error"
    });

    await runAgentLoop(
      makeMockConfig(),
      {
        emit: (e) => { events.push(e); },
        executePageTool: vi.fn(),
        executeBackgroundTool: vi.fn(),
        fetcher: fetcher as unknown as typeof fetch
      }
    );

    const error = events.find((e) => e.type === "AGENT_ERROR");
    expect(error).toBeDefined();
    expect((error as { payload: { error: string } }).payload.error).toContain("500");
  });

  it("respects abort signal", async () => {
    const events: AgentProgressEvent[] = [];
    const controller = new AbortController();
    controller.abort(); // Abort immediately

    await runAgentLoop(
      makeMockConfig(),
      {
        emit: (e) => { events.push(e); },
        executePageTool: vi.fn(),
        executeBackgroundTool: vi.fn()
      },
      controller.signal
    );

    const error = events.find((e) => e.type === "AGENT_ERROR");
    expect(error).toBeDefined();
    expect((error as { payload: { error: string } }).payload.error).toContain("cancelled");
  });
});
