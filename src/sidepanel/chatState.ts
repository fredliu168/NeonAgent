import type { ChatMessage } from "../shared/types.js";

export interface ChatState {
  messages: ChatMessage[];
  pending: boolean;
}

export type ChatStateAction =
  | { type: "SEND_USER_MESSAGE"; content: string }
  | { type: "RECEIVE_ASSISTANT_MESSAGE"; content: string }
  | { type: "START_ASSISTANT_STREAM" }
  | { type: "APPEND_ASSISTANT_DELTA"; delta: string }
  | { type: "APPEND_THINKING_DELTA"; delta: string }
  | { type: "SET_PENDING"; pending: boolean };

export function createInitialChatState(): ChatState {
  return {
    messages: [],
    pending: false
  };
}

export function reduceChatState(state: ChatState, action: ChatStateAction): ChatState {
  if (action.type === "SET_PENDING") {
    return {
      ...state,
      pending: action.pending
    };
  }

  if (action.type === "START_ASSISTANT_STREAM") {
    return {
      ...state,
      messages: [...state.messages, { role: "assistant", content: "" }]
    };
  }

  if (action.type === "APPEND_THINKING_DELTA") {
    const delta = action.delta;
    if (!delta) {
      return state;
    }

    if (state.messages.length === 0) {
      return state;
    }

    const lastIndex = state.messages.length - 1;
    const last = state.messages[lastIndex];
    if (last.role !== "assistant") {
      return state;
    }

    const messages = state.messages.slice();
    const existingThinking = last.reasoning_content ?? "";
    messages[lastIndex] = {
      ...last,
      reasoning_content: `${existingThinking}${delta}`
    } as ChatMessage;
    return {
      ...state,
      messages
    };
  }

  if (action.type === "APPEND_ASSISTANT_DELTA") {
    const delta = action.delta;
    if (!delta) {
      return state;
    }

    if (state.messages.length === 0) {
      return {
        ...state,
        messages: [{ role: "assistant", content: delta }]
      };
    }

    const lastIndex = state.messages.length - 1;
    const last = state.messages[lastIndex];
    if (last.role !== "assistant") {
      return {
        ...state,
        messages: [...state.messages, { role: "assistant", content: delta }]
      };
    }

    const messages = state.messages.slice();
    messages[lastIndex] = {
      ...last,
      content: `${last.content}${delta}`
    };
    return {
      ...state,
      messages
    };
  }

  const content = action.content.trim();
  if (!content) {
    return state;
  }

  const role = action.type === "SEND_USER_MESSAGE" ? "user" : "assistant";

  return {
    ...state,
    messages: [...state.messages, { role, content }]
  };
}