import type {
  ChatMessage,
  LLMConfig,
  LLMRequestPayload,
  LLMStreamCancelPayload,
  LLMStreamRequestPayload
} from "./types.js";

export function createLLMRequestMessage(input: {
  config: LLMConfig;
  messages: ChatMessage[];
  pageContext?: string;
}): LLMRequestPayload {
  return {
    type: "LLM_REQUEST",
    payload: {
      config: input.config,
      messages: input.messages,
      pageContext: input.pageContext
    }
  };
}

export function createLLMStreamRequestMessage(input: {
  requestId: string;
  config: LLMConfig;
  messages: ChatMessage[];
  pageContext?: string;
}): LLMStreamRequestPayload {
  return {
    type: "LLM_STREAM_REQUEST",
    payload: {
      requestId: input.requestId,
      config: input.config,
      messages: input.messages,
      pageContext: input.pageContext
    }
  };
}

export function createLLMStreamCancelMessage(input: {
  requestId: string;
}): LLMStreamCancelPayload {
  return {
    type: "LLM_STREAM_CANCEL",
    payload: {
      requestId: input.requestId
    }
  };
}