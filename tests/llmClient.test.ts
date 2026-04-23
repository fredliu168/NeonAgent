import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/shared/config";
import {
  requestChatCompletion,
  requestChatCompletionStream
} from "../src/shared/llmClient";

describe("requestChatCompletion", () => {
  it("sends request in OpenAI-compatible format", async () => {
    const fetcher = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "hello from model" } }]
        })
      };
    });

    const content = await requestChatCompletion(
      {
        config: {
          ...DEFAULT_CONFIG,
          baseUrl: "http://123.207.223.64:7600/v1/chat/completions",
          apiKey: "test-key",
          model: "Qwen/Qwen3-8B",
          temperature: 0.8,
          agentMaxTokens: 512,
          systemPrompt: ""
        },
        messages: [{ role: "user", content: "hello" }]
      },
      fetcher as unknown as typeof fetch
    );

    expect(content).toBe("hello from model");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("http://123.207.223.64:7600/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-key"
    });

    const body = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      temperature: number;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.model).toBe("Qwen/Qwen3-8B");
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0.8);
    expect(body.max_tokens).toBe(512); // agentMaxTokens
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("retries with max_completion_tokens when max_tokens is unsupported", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async () => ({
        ok: false,
        status: 400,
        text: async () =>
          "{ message: \"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.\", code: 'invalid_request_body' }"
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "fallback works" } }]
        })
      }));

    const content = await requestChatCompletion(
      {
        config: {
          ...DEFAULT_CONFIG,
          baseUrl: "http://example.com/v1/chat/completions",
          apiKey: "test-key",
          model: "Qwen/Qwen3-8B",
          agentMaxTokens: 768,
          systemPrompt: ""
        },
        messages: [{ role: "user", content: "hello" }]
      },
      fetcher as unknown as typeof fetch
    );

    expect(content).toBe("fallback works");
    expect(fetcher).toHaveBeenCalledTimes(2);

    const [, firstInit] = fetcher.mock.calls[0] as [string, RequestInit];
    const firstBody = JSON.parse(firstInit.body as string) as Record<string, unknown>;
    expect(firstBody.max_tokens).toBe(768); // agentMaxTokens
    expect(firstBody.max_completion_tokens).toBeUndefined();

    const [, secondInit] = fetcher.mock.calls[1] as [string, RequestInit];
    const secondBody = JSON.parse(secondInit.body as string) as Record<string, unknown>;
    expect(secondBody.max_tokens).toBeUndefined();
    expect(secondBody.max_completion_tokens).toBe(768); // agentMaxTokens
  });

  it("throws on non-2xx response", async () => {
    const fetcher = vi.fn(async () => {
      return {
        ok: false,
        status: 401,
        text: async () => "unauthorized"
      };
    });

    await expect(
      requestChatCompletion(
        {
          config: {
            ...DEFAULT_CONFIG,
            baseUrl: "http://example.com/v1/chat/completions",
            apiKey: "bad-key"
          },
          messages: [{ role: "user", content: "hello" }]
        },
        fetcher as unknown as typeof fetch
      )
    ).rejects.toThrow("LLM request failed");
  });

  it("streams chunks from SSE response", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
              "data: [DONE]\n\n"
          )
        );
        controller.close();
      }
    });

    const fetcher = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        body: stream
      };
    });

    const chunks: Array<{ content: string | null; reasoning: string | null }> = [];
    for await (const chunk of requestChatCompletionStream(
      {
        config: {
          ...DEFAULT_CONFIG,
          baseUrl: "http://123.207.223.64:7600/v1/chat/completions",
          apiKey: "test-key",
          model: "Qwen/Qwen3-8B",
          temperature: 0.8,
          systemPrompt: ""
        },
        messages: [{ role: "user", content: "hello" }]
      },
      fetcher as unknown as typeof fetch
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { content: "hel", reasoning: null },
      { content: "lo", reasoning: null }
    ]);
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { stream: boolean };
    expect(body.stream).toBe(true);
  });
});