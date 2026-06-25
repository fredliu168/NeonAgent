/**
 * LLM client with OpenAI function calling support for the browser agent.
 * Handles streaming responses that include tool_calls deltas.
 */

import type { LLMConfig } from "./types.js";
import { resolveMaxOutputTokens } from "./tokenBudget.js";
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

function isMiniMaxM3Model(model: string): boolean {
  return /^minimax-m3$/i.test(model.trim());
}

function getAgentRequestBodyExtras(config: LLMConfig): Record<string, unknown> | undefined {
  if (isMiniMaxM3Model(config.model)) {
    return {
      thinking: { type: "adaptive" },
      reasoning_split: true
    };
  }
  return undefined;
}

function extractReasoningDetailsText(
  details: Array<{ text?: string }> | undefined
): string | null {
  if (!Array.isArray(details) || details.length === 0) {
    return null;
  }

  const text = details
    .map((detail) => (typeof detail?.text === "string" ? detail.text : ""))
    .join("");

  return text || null;
}

function getStreamAppend(snapshotOrDelta: string, accumulated: string): string {
  if (!snapshotOrDelta) {
    return "";
  }
  if (accumulated && snapshotOrDelta.startsWith(accumulated)) {
    return snapshotOrDelta.slice(accumulated.length);
  }
  return snapshotOrDelta;
}

function fallbackStatusText(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 408:
      return "Request Timeout";
    case 409:
      return "Conflict";
    case 422:
      return "Unprocessable Entity";
    case 429:
      return "Too Many Requests";
    case 500:
      return "Internal Server Error";
    case 502:
      return "Bad Gateway";
    case 503:
      return "Service Unavailable";
    case 504:
      return "Gateway Timeout";
    default:
      return "Unknown error";
  }
}

async function readErrorDetails(response: Response): Promise<string> {
  const bodyText = await response.text().catch(() => "");
  const trimmedBodyText = bodyText.trim();
  if (trimmedBodyText) {
    return trimmedBodyText;
  }

  const trimmedStatusText = response.statusText.trim();
  if (trimmedStatusText) {
    return trimmedStatusText;
  }

  return fallbackStatusText(response.status);
}

function summarizeSerializedMessages(messages: unknown[]): string {
  const summary = messages.map((message, index) => {
    if (!message || typeof message !== "object") {
      return { index, invalid: true };
    }

    const msg = message as {
      role?: string;
      content?: unknown;
      reasoning_content?: unknown;
      tool_calls?: unknown[];
      tool_call_id?: string;
    };

    const contentSummary = Array.isArray(msg.content)
      ? msg.content.map((block) => {
          if (!block || typeof block !== "object") {
            return { invalid: true };
          }
          const typedBlock = block as { type?: string; thinking?: string; text?: string };
          return {
            type: typedBlock.type ?? null,
            thinkingLength: typeof typedBlock.thinking === "string" ? typedBlock.thinking.length : 0,
            textLength: typeof typedBlock.text === "string" ? typedBlock.text.length : 0
          };
        })
      : typeof msg.content === "string"
        ? { type: "string", length: msg.content.length }
        : msg.content === null
          ? { type: "null" }
          : { type: typeof msg.content };

    return {
      index,
      role: msg.role ?? null,
      content: contentSummary,
      reasoningLength: typeof msg.reasoning_content === "string" ? msg.reasoning_content.length : 0,
      toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0,
      toolCallId: typeof msg.tool_call_id === "string" ? msg.tool_call_id : null
    };
  });

  return JSON.stringify(summary);
}

function summarizeAgentMessages(messages: AgentMessage[]): string {
  const summary = messages.map((message, index) => ({
    index,
    role: message.role,
    contentLength: typeof message.content === "string" ? message.content.length : 0,
    hasNullContent: message.content === null,
    reasoningLength: typeof message.reasoning_content === "string" ? message.reasoning_content.length : 0,
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls.length : 0,
    toolCallId: typeof message.tool_call_id === "string" ? message.tool_call_id : null
  }));

  return JSON.stringify(summary);
}

function buildThinkingFormatError(
  status: number,
  text: string,
  input: {
    config: LLMConfig;
    messages: AgentMessage[];
  },
  tokenParamName: TokenParamName,
  thinkingFormat: "none" | "field" | "blocks"
): Error {
  const serializedMessages = serializeMessages(input.messages, thinkingFormat);
  const rawSummary = summarizeAgentMessages(input.messages);
  const summary = summarizeSerializedMessages(serializedMessages);
  return new Error(
    `Agent LLM request failed: ${status} ${text} [thinkingFormat=${thinkingFormat}, tokenParam=${tokenParamName}, rawMessageSummary=${rawSummary}, serializedMessageSummary=${summary}]`.trim()
  );
}

function buildThinkingFormatAttemptsError(
  attempts: Array<{
    status: number;
    text: string;
    thinkingFormat: "none" | "field" | "blocks";
    tokenParamName: TokenParamName;
    input: {
      config: LLMConfig;
      messages: AgentMessage[];
    };
  }>
): Error {
  if (attempts.length === 0) {
    return new Error("Agent LLM request failed: no attempts recorded");
  }

  const finalAttempt = attempts[attempts.length - 1];
  const attemptsSummary = attempts.map((attempt) => ({
    thinkingFormat: attempt.thinkingFormat,
    tokenParam: attempt.tokenParamName,
    status: attempt.status,
    text: attempt.text,
    serializedMessageSummary: JSON.parse(
      summarizeSerializedMessages(serializeMessages(attempt.input.messages, attempt.thinkingFormat))
    )
  }));

  const baseError = buildThinkingFormatError(
    finalAttempt.status,
    finalAttempt.text,
    finalAttempt.input,
    finalAttempt.tokenParamName,
    finalAttempt.thinkingFormat
  ).message;

  return new Error(`${baseError} [attempts=${JSON.stringify(attemptsSummary)}]`);
}

function parseAgentStreamLine(dataLine: string): AgentStreamDelta | null {
  const raw = dataLine.slice("data:".length).trim();
  if (!raw || raw === "[DONE]") {
    return null;
  }

  let parsed: {
    choices?: Array<{
      delta?: {
        content?: string | Array<{ type?: string; text?: string; thinking?: string }>;
        reasoning?: string;
        reasoning_content?: string;
        reasoning_details?: Array<{ text?: string }>;
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

  // content can be a plain string (OpenAI/DeepSeek) or a content-block array (Anthropic-style)
  let content: string | null = null;
  let reasoning: string | null = null;

  if (typeof delta?.content === "string") {
    content = delta.content;
  } else if (Array.isArray(delta?.content)) {
    for (const block of delta.content) {
      if (block.type === "thinking" && typeof block.thinking === "string") {
        reasoning = (reasoning ?? "") + block.thinking;
      } else if (block.type === "text" && typeof block.text === "string") {
        content = (content ?? "") + block.text;
      }
    }
  }

  // Also handle flat reasoning_content field (native DeepSeek)
  if (reasoning === null && typeof delta?.reasoning_content === "string") {
    reasoning = delta.reasoning_content;
  }

  if (reasoning === null && typeof delta?.reasoning === "string") {
    reasoning = delta.reasoning;
  }

  if (reasoning === null) {
    reasoning = extractReasoningDetailsText(delta?.reasoning_details);
  }

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

/**
 * Serialize messages for the API request according to the configured thinking format.
 * - "none"   : strip reasoning_content (standard OpenAI-compatible APIs)
 * - "field"  : keep as top-level reasoning_content field (native DeepSeek API)
 * - "blocks" : convert to content[].thinking blocks (Anthropic-compatible APIs)
 */
function serializeMessages(
  messages: AgentMessage[],
  thinkingFormat: "none" | "field" | "blocks"
): unknown[] {
  return messages.map((msg) => {
    if (msg.role === "assistant") {
      const { reasoning_content, content, tool_calls, ...rest } = msg as any;
      const base = { ...rest, ...(tool_calls ? { tool_calls } : {}) };

      // Anthropic-compatible proxies expect content[].thinking block returned
      if (thinkingFormat === "blocks") {
        const blocks: unknown[] = [
          { type: "thinking", thinking: reasoning_content || "" }
        ];
        // Preserve the original content shape as closely as possible when replaying
        // thinking mode. Some Anthropic-compatible proxies appear to validate the
        // full assistant content array, not just the thinking block itself.
        if (content && typeof content === "string") {
          blocks.push({ type: "text", text: content });
        } else if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type !== "thinking") blocks.push(c);
          }
        }
        const finalMsg: Record<string, unknown> = { ...base, content: blocks };
        if (reasoning_content) {
          finalMsg.reasoning_content = reasoning_content;
        }
        return finalMsg;
      }

      if (thinkingFormat === "field") {
        const finalMsg: any = { ...base, content: content ?? null };
        if (reasoning_content) {
          finalMsg.reasoning_content = reasoning_content;
        }
        return finalMsg;
      }

      // "none" - strip reasoning_content
      return { ...base, content: content ?? null };
    }
    return msg;
  });
}

function buildAgentRequestBody(input: {
  config: LLMConfig;
  messages: AgentMessage[];
  tools: ToolDefinition[];
}, tokenParamName: TokenParamName, maxOutputTokensOverride?: number): string {
  const messages = serializeMessages(input.messages, input.config.thinkingFormat ?? "field");
  const maxOutputTokens = resolveMaxOutputTokens({
    configuredMaxTokens: input.config.agentMaxTokens,
    model: input.config.model,
    payloadForInputEstimate: {
      messages,
      tools: input.tools
    }
  });
  const effectiveMaxOutputTokens = maxOutputTokensOverride
    ? Math.max(1, Math.min(maxOutputTokens, Math.floor(maxOutputTokensOverride)))
    : maxOutputTokens;
  const body: Record<string, unknown> = {
    ...(getAgentRequestBodyExtras(input.config) ?? {}),
    model: input.config.model,
    stream: true,
    temperature: input.config.temperature,
    messages,
    tools: input.tools,
    tool_choice: "auto"
  };

  body[tokenParamName] = effectiveMaxOutputTokens;

  return JSON.stringify(body);
}

function shouldRetryWithAlternateTokenParam(details: string, currentParam: TokenParamName): boolean {
  const normalized = details.toLowerCase();
  return normalized.includes("unsupported parameter") && normalized.includes(currentParam);
}

function parseContextLimitRetryMaxTokens(details: string): number | null {
  const contextMatch = details.match(/maximum context length is\s+(\d+)\s+tokens/i);
  const requestedMatch = details.match(/requested\s+(\d+)\s+output tokens/i);
  const inputMatch = details.match(/prompt contains at least\s+(\d+)\s+input tokens/i);
  if (!contextMatch || !requestedMatch || !inputMatch) {
    return null;
  }

  const contextLimit = Number.parseInt(contextMatch[1], 10);
  const requestedOutput = Number.parseInt(requestedMatch[1], 10);
  const inputTokens = Number.parseInt(inputMatch[1], 10);
  if (!Number.isFinite(contextLimit) || !Number.isFinite(requestedOutput) || !Number.isFinite(inputTokens)) {
    return null;
  }

  const retryMaxTokens = contextLimit - inputTokens - 1024;
  if (retryMaxTokens <= 0 || retryMaxTokens >= requestedOutput) {
    return null;
  }

  return Math.max(1, retryMaxTokens);
}

function isThinkingFormatError(text: string): "needs_blocks" | "needs_field" | null {
  const msg = text.toLowerCase();
  // API requires content[].thinking blocks to be sent back
  if (msg.includes("content[].thinking") && msg.includes("must be passed back")) {
    return "needs_blocks";
  }
  // API doesn't understand type:"thinking" content blocks
  if (msg.includes("unknown variant") && msg.includes("thinking")) {
    return "needs_field";
  }
  return null;
}

async function postAgentStreamRequest(
  input: {
    config: LLMConfig;
    messages: AgentMessage[];
    tools: ToolDefinition[];
    signal?: AbortSignal;
  },
  tokenParamName: TokenParamName,
  fetcher: typeof fetch,
  overrideThinkingFormat?: "none" | "field" | "blocks",
  maxOutputTokensOverride?: number
): Promise<Response> {
  const effectiveConfig = overrideThinkingFormat
    ? { ...input.config, thinkingFormat: overrideThinkingFormat }
    : input.config;
  return fetcher(input.config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.config.apiKey}`
    },
    signal: input.signal,
    body: buildAgentRequestBody({ ...input, config: effectiveConfig }, tokenParamName, maxOutputTokensOverride)
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

  // Attempt order for thinking formats when auto-retrying
  const thinkingFormats: Array<"field" | "blocks" | "none"> = ["field", "blocks", "none"];

  async function tryWithParam(tokenParam: TokenParamName): Promise<Response | null> {
    const configFormat = input.config.thinkingFormat ?? "field";
    const attempts: Array<{
      status: number;
      text: string;
      thinkingFormat: "none" | "field" | "blocks";
      tokenParamName: TokenParamName;
      input: {
        config: LLMConfig;
        messages: AgentMessage[];
      };
    }> = [];

    // First try with configured format
    const resp = await postAgentStreamRequest(input, tokenParam, fetcher);
    if (resp.ok) return resp;

    const text = await readErrorDetails(resp);
    attempts.push({
      status: resp.status,
      text,
      thinkingFormat: configFormat,
      tokenParamName: tokenParam,
      input
    });

    const retryMaxTokens = parseContextLimitRetryMaxTokens(text);
    if (retryMaxTokens) {
      const retryResp = await postAgentStreamRequest(input, tokenParam, fetcher, undefined, retryMaxTokens);
      if (retryResp.ok) {
        return retryResp;
      }
        attempts.push({
          status: retryResp.status,
          text: await readErrorDetails(retryResp),
          thinkingFormat: configFormat,
          tokenParamName: tokenParam,
          input
        });
    }

    // Check for token param retry
    if (shouldRetryWithAlternateTokenParam(text, tokenParam)) {
      return null; // signal caller to try secondary param
    }

    // Check for thinking format error — try all other formats
    const formatHint = isThinkingFormatError(text);
    if (formatHint) {
      const order = formatHint === "needs_blocks"
        ? (["blocks", "field"] as const)
        : (["field", "none", "blocks"] as const);
      for (const fmt of order) {
        if (fmt === configFormat) continue;
        const retryResp = await postAgentStreamRequest(input, tokenParam, fetcher, fmt);
        if (retryResp.ok) {
          // Persist the working format so subsequent loop iterations use it directly
          input.config.thinkingFormat = fmt;
          return retryResp;
        }
        attempts.push({
          status: retryResp.status,
          text: await readErrorDetails(retryResp),
          thinkingFormat: fmt,
          tokenParamName: tokenParam,
          input
        });
      }
      throw buildThinkingFormatAttemptsError(attempts);
    }

    throw buildThinkingFormatError(resp.status, text, input, tokenParam, configFormat);
  }

  const primary = await tryWithParam(primaryParam);
  if (primary) return primary;

  // Retry with alternate token param
  const fallbackResp = await postAgentStreamRequest(input, secondaryParam, fetcher);
  if (fallbackResp.ok) return fallbackResp;

  const fallbackText = await readErrorDetails(fallbackResp);
  const fallbackAttempts: Array<{
    status: number;
    text: string;
    thinkingFormat: "none" | "field" | "blocks";
    tokenParamName: TokenParamName;
    input: {
      config: LLMConfig;
      messages: AgentMessage[];
    };
  }> = [{
    status: fallbackResp.status,
    text: fallbackText,
    thinkingFormat: input.config.thinkingFormat ?? "field",
    tokenParamName: secondaryParam,
    input
  }];

  const formatHint = isThinkingFormatError(fallbackText);
  const retryMaxTokens = parseContextLimitRetryMaxTokens(fallbackText);
  if (retryMaxTokens) {
    const retryResp = await postAgentStreamRequest(input, secondaryParam, fetcher, undefined, retryMaxTokens);
    if (retryResp.ok) {
      return retryResp;
    }
    fallbackAttempts.push({
      status: retryResp.status,
      text: await readErrorDetails(retryResp),
      thinkingFormat: input.config.thinkingFormat ?? "field",
      tokenParamName: secondaryParam,
      input
    });
  }

  if (formatHint) {
    const configFormat = input.config.thinkingFormat ?? "field";
    const order = formatHint === "needs_blocks"
      ? (["blocks", "field"] as const)
      : (["field", "none", "blocks"] as const);
    for (const fmt of order) {
      if (fmt === configFormat) continue;
      const retryResp = await postAgentStreamRequest(input, secondaryParam, fetcher, fmt);
      if (retryResp.ok) {
        input.config.thinkingFormat = fmt;
        return retryResp;
      }
      fallbackAttempts.push({
        status: retryResp.status,
        text: await readErrorDetails(retryResp),
        thinkingFormat: fmt,
        tokenParamName: secondaryParam,
        input
      });
    }
    throw buildThinkingFormatAttemptsError(fallbackAttempts);
  }

  throw buildThinkingFormatError(
    fallbackResp.status,
    fallbackText,
    input,
    secondaryParam,
    input.config.thinkingFormat ?? "field"
  );
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
        const contentDelta = getStreamAppend(delta.content, accContent);
        if (contentDelta) {
          accContent += contentDelta;
          callbacks?.onTextDelta?.(contentDelta);
        }
      }

      if (delta.reasoning) {
        const reasoningDelta = getStreamAppend(delta.reasoning, accThinking);
        if (reasoningDelta) {
          accThinking += reasoningDelta;
          callbacks?.onThinkingDelta?.(reasoningDelta);
        }
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
        const contentDelta = getStreamAppend(delta.content, accContent);
        if (contentDelta) {
          accContent += contentDelta;
          callbacks?.onTextDelta?.(contentDelta);
        }
      }
      if (delta.reasoning) {
        const reasoningDelta = getStreamAppend(delta.reasoning, accThinking);
        if (reasoningDelta) {
          accThinking += reasoningDelta;
          callbacks?.onThinkingDelta?.(reasoningDelta);
        }
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
