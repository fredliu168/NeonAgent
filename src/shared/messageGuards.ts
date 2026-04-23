import type { RuntimeMessage } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRole(value: unknown): value is "system" | "user" | "assistant" {
  return value === "system" || value === "user" || value === "assistant";
}

function isChatMessage(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }
  return isRole(value.role) && typeof value.content === "string";
}

function isLLMConfig(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.baseUrl === "string" &&
    typeof value.apiKey === "string" &&
    typeof value.model === "string" &&
    Array.isArray(value.models) &&
    typeof value.temperature === "number" &&
    typeof value.maxTokens === "number" &&
    typeof value.systemPrompt === "string"
  );
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!isObject(value) || typeof value.type !== "string") {
    return false;
  }

  if (value.type === "PING") {
    return Object.keys(value).length === 1;
  }

  if (value.type === "LLM_REQUEST") {
    if (!isObject(value.payload)) {
      return false;
    }

    if (!isLLMConfig(value.payload.config)) {
      return false;
    }

    if (!Array.isArray(value.payload.messages)) {
      return false;
    }

    if (!value.payload.messages.every(isChatMessage)) {
      return false;
    }

    if (
      typeof value.payload.pageContext !== "undefined" &&
      typeof value.payload.pageContext !== "string"
    ) {
      return false;
    }

    return true;
  }

  if (value.type === "LLM_STREAM_REQUEST") {
    if (!isObject(value.payload)) {
      return false;
    }

    if (typeof value.payload.requestId !== "string" || !value.payload.requestId.trim()) {
      return false;
    }

    if (!isLLMConfig(value.payload.config)) {
      return false;
    }

    if (!Array.isArray(value.payload.messages)) {
      return false;
    }

    if (!value.payload.messages.every(isChatMessage)) {
      return false;
    }

    if (
      typeof value.payload.pageContext !== "undefined" &&
      typeof value.payload.pageContext !== "string"
    ) {
      return false;
    }

    return true;
  }

  if (value.type === "LLM_STREAM_CANCEL") {
    if (!isObject(value.payload)) {
      return false;
    }

    return typeof value.payload.requestId === "string" && !!value.payload.requestId.trim();
  }

  return false;
}