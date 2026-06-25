import { describe, expect, it } from "vitest";
import { sanitizeExamStemText } from "../src/shared/examQuestionText";

describe("sanitizeExamStemText", () => {
  it("removes exam summary chrome before a fake extracted stem", () => {
    expect(
      sanitizeExamStemText("本卷共20题，总分100分 已答：0 未答：20 我要交卷")
    ).toBe("");
  });

  it("removes active exam title chrome", () => {
    expect(
      sanitizeExamStemText("正在作答: “十五五”战略全员知识赋能行动在线考试")
    ).toBe("");
  });

  it("keeps only the real numbered question after question chrome", () => {
    expect(
      sanitizeExamStemText("单选题(1/20) 本题分数:5 待检查 1、 行业拓展落地执行的“三张清单”是（ ）。")
    ).toBe("行业拓展落地执行的“三张清单”是（ ）。");
  });

  it("keeps a normal question stem unchanged apart from the leading number", () => {
    expect(
      sanitizeExamStemText("1. 行业拓展落地执行的“三张清单”是（ ）。")
    ).toBe("行业拓展落地执行的“三张清单”是（ ）。");
  });
});
