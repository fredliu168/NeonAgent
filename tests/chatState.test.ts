import { describe, expect, it } from "vitest";
import {
  createInitialChatState,
  reduceChatState,
  type ChatStateAction
} from "../src/sidepanel/chatState";

function applyActions(actions: ChatStateAction[]) {
  return actions.reduce(reduceChatState, createInitialChatState());
}

describe("chatState reducer", () => {
  it("adds user message and toggles pending state", () => {
    const state = applyActions([
      { type: "SEND_USER_MESSAGE", content: "hello" },
      { type: "SET_PENDING", pending: true }
    ]);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(state.pending).toBe(true);
  });

  it("adds assistant message and clears pending", () => {
    const state = applyActions([
      { type: "SEND_USER_MESSAGE", content: "hello" },
      { type: "SET_PENDING", pending: true },
      { type: "RECEIVE_ASSISTANT_MESSAGE", content: "world" },
      { type: "SET_PENDING", pending: false }
    ]);

    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({ role: "assistant", content: "world" });
    expect(state.pending).toBe(false);
  });

  it("ignores empty messages", () => {
    const state = applyActions([
      { type: "SEND_USER_MESSAGE", content: "  " },
      { type: "RECEIVE_ASSISTANT_MESSAGE", content: "" }
    ]);

    expect(state.messages).toHaveLength(0);
  });

  it("supports assistant streaming delta append", () => {
    const state = applyActions([
      { type: "SEND_USER_MESSAGE", content: "hello" },
      { type: "START_ASSISTANT_STREAM" },
      { type: "APPEND_ASSISTANT_DELTA", delta: "hel" },
      { type: "APPEND_ASSISTANT_DELTA", delta: "lo" },
      { type: "SET_PENDING", pending: false }
    ]);

    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({ role: "assistant", content: "hello" });
    expect(state.pending).toBe(false);
  });
});