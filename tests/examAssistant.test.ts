import { describe, expect, it } from "vitest";
import { matchAnswersFromText, normalizeQuestionBlocks } from "../src/shared/examAssistant";

describe("exam assistant", () => {
  it("normalizes question blocks with fallback ids and labels", () => {
    const questions = normalizeQuestionBlocks([
      {
        stem: "  1+1=?  ",
        options: [
          { text: " 1 " },
          { text: " 2 " }
        ]
      }
    ]);

    expect(questions).toEqual([
      {
        id: "q_1",
        stem: "1+1=?",
        options: [
          { label: "A", text: "1" },
          { label: "B", text: "2" }
        ]
      }
    ]);
  });

  it("matches answer labels from model output text", () => {
    const questions = normalizeQuestionBlocks([
      {
        id: "q_1",
        stem: "1+1=?",
        options: [
          { label: "A", text: "1" },
          { label: "B", text: "2" }
        ]
      },
      {
        id: "q_2",
        stem: "2+2=?",
        options: [
          { label: "A", text: "3" },
          { label: "B", text: "4" }
        ]
      }
    ]);

    const matches = matchAnswersFromText(
      questions,
      "答案：q_1: B\nq_2: B"
    );

    expect(matches).toEqual([
      { questionId: "q_1", answerLabel: "B" },
      { questionId: "q_2", answerLabel: "B" }
    ]);
  });

  it("matches multi-select labels from comma-separated output", () => {
    const questions = normalizeQuestionBlocks([
      {
        id: "q_1",
        stem: "哪些是偶数?",
        options: [
          { label: "A", text: "1" },
          { label: "B", text: "2" },
          { label: "C", text: "4" }
        ]
      }
    ]).map((question) => ({ ...question, questionType: "multiple" as const }));

    const matches = matchAnswersFromText(questions, "1. B,C");

    expect(matches).toEqual([
      { questionId: "q_1", answerLabel: "B", answerLabels: ["B", "C"] }
    ]);
  });

  it("matches judgement answers from semantic words", () => {
    const questions = normalizeQuestionBlocks([
      {
        id: "q_1",
        stem: "地球是圆的吗?",
        options: [
          { label: "A", text: "正确" },
          { label: "B", text: "错误" }
        ]
      }
    ]).map((question) => ({ ...question, questionType: "judgement" as const }));

    const matches = matchAnswersFromText(questions, "q_1: 正确");

    expect(matches).toEqual([
      { questionId: "q_1", answerLabel: "A" }
    ]);
  });
});
