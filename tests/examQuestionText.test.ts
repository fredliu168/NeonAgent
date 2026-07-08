import { describe, expect, it } from "vitest";

import { sanitizeExamStemText } from "../src/shared/examQuestionText";

describe("sanitizeExamStemText", () => {
  it("drops question navigator chrome that can be mistaken for the first question", () => {
    const raw = "题目： 1 2 1. [单选] [10] 判断题[10] 多选题[10] 简答题[2] 综合题[1] 交卷 A. 单选题[10] B. 判断题[10] C. 多选题[10] D. 简答题[2] E. 综合题[1]";

    expect(sanitizeExamStemText(raw)).toBe("");
  });

  it("drops upload-helper ui hints even when they are prefixed like a question", () => {
    const raw = "题目： 1 2 2. [单选] 推荐使用微信文件传输助手传输答案照片到电脑";

    expect(sanitizeExamStemText(raw)).toBe("");
  });

  it("keeps the real question stem after navigator noise", () => {
    const raw = "题目： 1 2 3. [单选] 以下哪项不属于小学心理健康教育的原则？（ ）";

    expect(sanitizeExamStemText(raw)).toBe("[单选] 以下哪项不属于小学心理健康教育的原则？（ ）");
  });
});
