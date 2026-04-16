import type { ChatMessage, LLMConfig } from "./types.js";

interface RequestChatCompletionInput {
  config: LLMConfig;
  messages: ChatMessage[];
  pageContext?: string;
  signal?: AbortSignal;
}

function buildRequestBody(input: RequestChatCompletionInput, stream: boolean): string {
  return JSON.stringify({
    model: input.config.model,
    stream,
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    messages: buildMessages(input)
  });
}

export interface StreamDelta {
  content: string | null;
  reasoning: string | null;
}

function parseStreamDelta(dataLine: string): StreamDelta | null {
  const data = dataLine.slice("data:".length).trim();
  if (!data || data === "[DONE]") {
    return null;
  }

  let parsed: {
    choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
  };

  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  const delta = parsed.choices?.[0]?.delta;
  const content = typeof delta?.content === "string" ? delta.content : null;
  const reasoning = typeof delta?.reasoning_content === "string" ? delta.reasoning_content : null;

  if (content === null && reasoning === null) {
    return null;
  }

  return { content, reasoning };
}

function buildMessages(input: RequestChatCompletionInput): ChatMessage[] {
  const merged: ChatMessage[] = [];

  if (input.config.systemPrompt.trim()) {
    merged.push({ role: "system", content: input.config.systemPrompt.trim() });
  }

  if (input.pageContext?.trim()) {
    merged.push({ role: "system", content: `Page context:\n${input.pageContext.trim()}` });
  }

  merged.push(...input.messages);
  return merged;
}

export async function requestChatCompletion(
  input: RequestChatCompletionInput,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const response = await fetcher(input.config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.config.apiKey}`
    },
    body: buildRequestBody(input, false)
  });

  if (!response.ok) {
    const details = typeof response.text === "function" ? await response.text() : "";
    throw new Error(`LLM request failed: ${response.status} ${details}`.trim());
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("LLM response missing content");
  }

  return content;
}

export async function* requestChatCompletionStream(
  input: RequestChatCompletionInput,
  fetcher: typeof fetch = fetch
): AsyncGenerator<StreamDelta> {
  const response = await fetcher(input.config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.config.apiKey}`
    },
    signal: input.signal,
    body: buildRequestBody(input, true)
  });

  if (!response.ok) {
    const details = typeof response.text === "function" ? await response.text() : "";
    throw new Error(`LLM request failed: ${response.status} ${details}`.trim());
  }

  if (!response.body) {
    throw new Error("LLM stream response body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const delta = parseStreamDelta(trimmed);
      if (delta) {
        yield delta;
      }
    }
  }

  if (buffer.trim().startsWith("data:")) {
    const delta = parseStreamDelta(buffer.trim());
    if (delta) {
      yield delta;
    }
  }
}