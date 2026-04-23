import type { ChatMessage, LLMConfig } from "./types.js";

interface RequestChatCompletionInput {
  config: LLMConfig;
  messages: ChatMessage[];
  pageContext?: string;
  signal?: AbortSignal;
}

type TokenParamName = "max_tokens" | "max_completion_tokens";

function buildRequestBody(
  input: RequestChatCompletionInput,
  stream: boolean,
  tokenParamName: TokenParamName
): string {
  return JSON.stringify({
    model: input.config.model,
    stream,
    temperature: input.config.temperature,
    [tokenParamName]: input.config.agentMaxTokens,
    messages: buildMessages(input)
  });
}

function shouldRetryWithAlternateTokenParam(details: string, currentParam: TokenParamName): boolean {
  const normalized = details.toLowerCase();
  return normalized.includes("unsupported parameter") && normalized.includes(currentParam);
}

async function postChatCompletion(
  input: RequestChatCompletionInput,
  stream: boolean,
  tokenParamName: TokenParamName,
  fetcher: typeof fetch
): Promise<Response> {
  return fetcher(input.config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.config.apiKey}`
    },
    signal: input.signal,
    body: buildRequestBody(input, stream, tokenParamName)
  });
}

async function requestWithTokenFallback(
  input: RequestChatCompletionInput,
  stream: boolean,
  fetcher: typeof fetch
): Promise<Response> {
  const primaryParam: TokenParamName = "max_tokens";
  const secondaryParam: TokenParamName = "max_completion_tokens";

  const primaryResponse = await postChatCompletion(input, stream, primaryParam, fetcher);
  if (primaryResponse.ok) {
    return primaryResponse;
  }

  const primaryDetails = typeof primaryResponse.text === "function" ? await primaryResponse.text() : "";
  if (!shouldRetryWithAlternateTokenParam(primaryDetails, primaryParam)) {
    throw new Error(`LLM request failed: ${primaryResponse.status} ${primaryDetails}`.trim());
  }

  const fallbackResponse = await postChatCompletion(input, stream, secondaryParam, fetcher);
  if (fallbackResponse.ok) {
    return fallbackResponse;
  }

  const fallbackDetails = typeof fallbackResponse.text === "function" ? await fallbackResponse.text() : "";
  throw new Error(`LLM request failed: ${fallbackResponse.status} ${fallbackDetails}`.trim());
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
  const response = await requestWithTokenFallback(input, false, fetcher);

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
  const response = await requestWithTokenFallback(input, true, fetcher);

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