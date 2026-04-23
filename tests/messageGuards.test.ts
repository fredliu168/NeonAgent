import { describe, expect, it } from "vitest";
import { isRuntimeMessage } from "../src/shared/messageGuards";
import { DEFAULT_CONFIG } from "../src/shared/config";

describe("isRuntimeMessage", () => {
  it("accepts PING message", () => {
    expect(isRuntimeMessage({ type: "PING" })).toBe(true);
  });

  it("accepts well-formed LLM_REQUEST message", () => {
    const value = {
      type: "LLM_REQUEST",
      payload: {
        config: {
          ...DEFAULT_CONFIG,
          baseUrl: "https://api.example.com/v1/chat/completions",
          apiKey: "test-key"
        },
        messages: [{ role: "user", content: "hello" }],
        pageContext: "sample page"
      }
    };

    expect(isRuntimeMessage(value)).toBe(true);
  });

  it("accepts well-formed LLM_STREAM_REQUEST with feature flags", () => {
    const value = {
      type: "LLM_STREAM_REQUEST",
      payload: {
        requestId: "req-1",
        config: {
          ...DEFAULT_CONFIG,
          baseUrl: "https://api.example.com/v1/chat/completions",
          apiKey: "test-key",
          unlockContextMenu: true,
          blockVisibilityDetection: true,
          aggressiveVisibilityBypass: true,
          enableFloatingBall: false
        },
        messages: [{ role: "user", content: "hello" }]
      }
    };

    expect(isRuntimeMessage(value)).toBe(true);
  });

  it("rejects malformed messages", () => {
    expect(isRuntimeMessage(null)).toBe(false);
    expect(isRuntimeMessage({})).toBe(false);
    expect(isRuntimeMessage({ type: "PING", payload: { any: true } })).toBe(false);
    expect(
      isRuntimeMessage({
        type: "LLM_REQUEST",
        payload: { config: {}, messages: [] }
      })
    ).toBe(false);
  });

  it("accepts well-formed LLM_STREAM_CANCEL message", () => {
    expect(
      isRuntimeMessage({
        type: "LLM_STREAM_CANCEL",
        payload: { requestId: "req-1" }
      })
    ).toBe(true);
  });
});