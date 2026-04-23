import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/shared/config";
import {
  createLLMRequestMessage,
  createLLMStreamCancelMessage
} from "../src/shared/messages";

describe("createLLMRequestMessage", () => {
  it("creates a well-formed LLM_REQUEST message", () => {
    const message = createLLMRequestMessage({
      config: {
        ...DEFAULT_CONFIG,
        baseUrl: "https://api.example.com/v1/chat/completions",
        apiKey: "key"
      },
      messages: [{ role: "user", content: "hello" }],
      pageContext: "sample page"
    });

    expect(message.type).toBe("LLM_REQUEST");
    expect(message.payload.messages).toHaveLength(1);
    expect(message.payload.messages[0].content).toBe("hello");
    expect(message.payload.pageContext).toBe("sample page");
  });

  it("creates a well-formed LLM_STREAM_CANCEL message", () => {
    const message = createLLMStreamCancelMessage({ requestId: "req-1" });
    expect(message).toEqual({
      type: "LLM_STREAM_CANCEL",
      payload: { requestId: "req-1" }
    });
  });
});