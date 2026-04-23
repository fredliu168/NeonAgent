import { describe, expect, it, vi } from "vitest";
import { createContentMessageHandler } from "../src/contentMessageHandler";
import type { ExamQuestion } from "../src/shared/types";

describe("content message handler", () => {
  it("returns page context for GET_PAGE_CONTEXT", () => {
    const handler = createContentMessageHandler({
      getContext: () => "Title: Test\n\nContext:\nHello"
    });
    const sendResponse = vi.fn();

    handler({ type: "GET_PAGE_CONTEXT" }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Title: Test\n\nContext:\nHello"
    });
  });

  it("returns error for unknown message type", () => {
    const handler = createContentMessageHandler({ getContext: () => "unused" });
    const sendResponse = vi.fn();

    handler({ type: "UNKNOWN" }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      errors: ["Unknown message type"]
    });
  });

  it("applies feature flags for APPLY_FEATURE_FLAGS", () => {
    const applyFlags = vi.fn();
    const handler = createContentMessageHandler({
      getContext: () => "unused",
      applyFlags
    });
    const sendResponse = vi.fn();

    handler(
      {
        type: "APPLY_FEATURE_FLAGS",
        payload: {
          unlockContextMenu: true,
          blockVisibilityDetection: true,
          aggressiveVisibilityBypass: true,
          enableFloatingBall: false
        }
      },
      {},
      sendResponse
    );

    expect(applyFlags).toHaveBeenCalledWith({
      unlockContextMenu: true,
      blockVisibilityDetection: true,
      aggressiveVisibilityBypass: true,
      enableFloatingBall: false
    });
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it("applies default feature flags when APPLY_FEATURE_FLAGS has no payload", () => {
    const applyFlags = vi.fn();
    const handler = createContentMessageHandler({
      getContext: () => "unused",
      applyFlags
    });
    const sendResponse = vi.fn();

    handler({ type: "APPLY_FEATURE_FLAGS" }, {}, sendResponse);

    expect(applyFlags).toHaveBeenCalledWith({
      unlockContextMenu: false,
      blockVisibilityDetection: false,
      aggressiveVisibilityBypass: false,
      enableFloatingBall: false
    });
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it("returns parsed exam questions for GET_EXAM_QUESTIONS", () => {
    const questions: ExamQuestion[] = [
      {
        id: "q_1",
        stem: "1+1=?",
        options: [
          { label: "A", text: "1" },
          { label: "B", text: "2" }
        ]
      }
    ];
    const handler = createContentMessageHandler({
      getContext: () => "unused",
      getExamQuestions: () => questions
    });
    const sendResponse = vi.fn();

    handler({ type: "GET_EXAM_QUESTIONS" }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: questions });
  });

  it("applies answer matches for APPLY_EXAM_ANSWERS", () => {
    const applyExamAnswers = vi.fn(() => ({ applied: 2 }));
    const handler = createContentMessageHandler({
      getContext: () => "unused",
      applyExamAnswers
    });
    const sendResponse = vi.fn();

    handler(
      {
        type: "APPLY_EXAM_ANSWERS",
        payload: {
          matches: [
            { questionId: "q_1", answerLabel: "B" },
            { questionId: "q_2", answerLabel: "A" }
          ]
        }
      },
      {},
      sendResponse
    );

    expect(applyExamAnswers).toHaveBeenCalledWith([
      { questionId: "q_1", answerLabel: "B" },
      { questionId: "q_2", answerLabel: "A" }
    ]);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { applied: 2 } });
  });
});