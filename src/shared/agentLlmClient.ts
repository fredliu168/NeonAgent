/**
 * LLM client with OpenAI function calling support for the browser agent.
 * Handles streaming responses that include tool_calls deltas.
 */

import type { LLMConfig } from "./types.js";
import type {
  AgentMessage,
  AgentStreamResult,
  PendingToolCall,
  ToolCall,
  ToolDefinition
} from "./agentTypes.js";

export interface AgentStreamDelta {
  content: string | null;
  reasoning: string | null;
  toolCalls: Array<{
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  }> | null;
  finishReason: string | null;
}

type TokenParamName = "max_tokens" | "max_completion_tokens";

function parseAgentStreamLine(dataLine: string): AgentStreamDelta | null {
  const raw = dataLine.slice("data:".length).trim();
  if (!raw || raw === "[DONE]") {
    return null;
  }

  let parsed: {
    choices?: Array<{
      delta?: {
        content?: string;
        reasoning_content?: string;
        tool_calls?: Array<{
          index: number;
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
  };

  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed JSON from SSE stream — skip this chunk
    return null;
  }

  const choice = parsed.choices?.[0];
  if (!choice) {
    return null;
  }

  const delta = choice.delta;
  const content =
    typeof delta?.content === "string" ? delta.content : null;
  const reasoning =
    typeof delta?.reasoning_content === "string" ? delta.reasoning_content : null;
  const finishReason = choice.finish_reason ?? null;

  let toolCalls: AgentStreamDelta["toolCalls"] = null;
  if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) {
    toolCalls = delta.tool_calls.map((tc) => ({
      index: tc.index,
      id: tc.id,
      name: tc.function?.name,
      argumentsDelta: tc.function?.arguments
    }));
  }

  if (
    content === null &&
    reasoning === null &&
    toolCalls === null &&
    finishReason === null
  ) {
    return null;
  }

  return { content, reasoning, toolCalls, finishReason };
}

function buildAgentRequestBody(input: {
  config: LLMConfig;
  messages: AgentMessage[];
  tools: ToolDefinition[];
}, tokenParamName: TokenParamName): string {
  const body: Record<string, unknown> = {
    model: input.config.model,
    stream: true,
    temperature: input.config.temperature,
    messages: input.messages,
    tools: input.tools,
    tool_choice: "auto"
  };

  body[tokenParamName] = input.config.agentMaxTokens;

  return JSON.stringify(body);
}

function shouldRetryWithAlternateTokenParam(details: string, currentParam: TokenParamName): boolean {
  const normalized = details.toLowerCase();
  return normalized.includes("unsupported parameter") && normalized.includes(currentParam);
}

async function postAgentStreamRequest(
  input: {
    config: LLMConfig;
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
  },
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
    body: buildAgentRequestBody(input, tokenParamName)
  });
}

async function requestAgentWithTokenFallback(
  input: {
    config: LLMConfig;
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
  },
  fetcher: typeof fetch
): Promise<Response> {
  const primaryParam: TokenParamName = "max_tokens";
  const secondaryParam: TokenParamName = "max_completion_tokens";

  const primaryResponse = await postAgentStreamRequest(input, primaryParam, fetcher);
  if (primaryResponse.ok) {
    return primaryResponse;
  }

  const primaryText = typeof primaryResponse.text === "function" ? await primaryResponse.text() : "";
  if (!shouldRetryWithAlternateTokenParam(primaryText, primaryParam)) {
    throw new Error(`Agent LLM request failed: ${primaryResponse.status} ${primaryText}`.trim());
  }

  const fallbackResponse = await postAgentStreamRequest(input, secondaryParam, fetcher);
  if (fallbackResponse.ok) {
    return fallbackResponse;
  }

  const fallbackText = typeof fallbackResponse.text === "function" ? await fallbackResponse.text() : "";
  throw new Error(`Agent LLM request failed: ${fallbackResponse.status} ${fallbackText}`.trim());
}

export interface AgentStreamCallbacks {
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  onToolCallStart?: (index: number, id: string, name: string) => void;
}

/**
 * Stream an LLM request with function calling.
 * Returns the accumulated content, thinking, and completed tool calls.
 */
export async function requestAgentStream(
  input: {
    config: LLMConfig;
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
  },
  callbacks?: AgentStreamCallbacks,
  fetcher: typeof fetch = fetch
): Promise<AgentStreamResult> {
  const response = await requestAgentWithTokenFallback(input, fetcher);

  if (!response.body) {
    throw new Error("Agent LLM stream response body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let accContent = "";
  let accThinking = "";
  const pendingToolCalls = new Map<number, PendingToolCall>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const delta = parseAgentStreamLine(trimmed);
      if (!delta) continue;

      if (delta.content) {
        accContent += delta.content;
        callbacks?.onTextDelta?.(delta.content);
      }

      if (delta.reasoning) {
        accThinking += delta.reasoning;
        callbacks?.onThinkingDelta?.(delta.reasoning);
      }

      if (delta.toolCalls) {
        for (const tc of delta.toolCalls) {
          let pending = pendingToolCalls.get(tc.index);
          if (!pending) {
            pending = {
              index: tc.index,
              id: tc.id ?? `tool_${tc.index}`,
              name: tc.name ?? "",
              arguments: ""
            };
            pendingToolCalls.set(tc.index, pending);
            if (tc.id && tc.name) {
              callbacks?.onToolCallStart?.(tc.index, tc.id, tc.name);
            }
          }
          if (tc.id) pending.id = tc.id;
          if (tc.name) pending.name = tc.name;
          if (tc.argumentsDelta) {
            pending.arguments += tc.argumentsDelta;
          }
        }
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim().startsWith("data:")) {
    const delta = parseAgentStreamLine(buffer.trim());
    if (delta) {
      if (delta.content) {
        accContent += delta.content;
        callbacks?.onTextDelta?.(delta.content);
      }
      if (delta.reasoning) {
        accThinking += delta.reasoning;
        callbacks?.onThinkingDelta?.(delta.reasoning);
      }
    }
  }

  // Build final tool calls
  const toolCalls: ToolCall[] = [];
  const sortedIndices = [...pendingToolCalls.keys()].sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    const p = pendingToolCalls.get(idx)!;
    toolCalls.push({
      id: p.id,
      type: "function",
      function: {
        name: p.name,
        arguments: p.arguments
      }
    });
  }

  return {
    content: accContent,
    thinking: accThinking,
    toolCalls
  };
}
