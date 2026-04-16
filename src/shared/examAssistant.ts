import type { ExamAnswerMatch, ExamQuestion } from "./types.js";

export interface RawQuestionBlock {
  id?: string;
  stem: string;
  options: Array<{ label?: string; text: string }>;
}

const FALLBACK_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeLabel(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function normalizeQuestionBlocks(blocks: RawQuestionBlock[]): ExamQuestion[] {
  return blocks
    .map((block, index) => {
      const stem = normalizeText(block.stem);
      const options = block.options
        .map((option, optionIndex) => {
          const label = normalizeLabel(option.label ?? FALLBACK_LABELS[optionIndex] ?? "");
          const text = normalizeText(option.text);
          return { label, text };
        })
        .filter((option) => !!option.label && !!option.text);

      return {
        id: block.id?.trim() || `q_${index + 1}`,
        stem,
        options
      };
    })
    .filter((question) => !!question.stem && question.options.length >= 2);
}

function buildQuestionRegex(question: ExamQuestion, questionIndex: number): RegExp {
  const escapedId = question.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:${escapedId}|\\b${questionIndex + 1}\\b)\\s*[).、:：-]*\\s*([^\\n]+)`, "i");
}

function buildOptionRegex(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b\\s*[:：.、-]`, "i");
}

function mapJudgementKeywordToLabel(question: ExamQuestion, answerText: string): string | null {
  const normalized = normalizeText(answerText).toLowerCase();
  const trueWords = ["true", "正确", "对", "yes", "√", "是"];
  const falseWords = ["false", "错误", "错", "no", "×", "否"];

  const matchedTrue = trueWords.some((word) => normalized.includes(word));
  const matchedFalse = falseWords.some((word) => normalized.includes(word));

  if (!matchedTrue && !matchedFalse) {
    return null;
  }

  const trueOption = question.options.find((option) => /正确|对|true|yes|是/i.test(option.text));
  const falseOption = question.options.find((option) => /错误|错|false|no|否/i.test(option.text));

  if (matchedTrue && trueOption) {
    return trueOption.label;
  }

  if (matchedFalse && falseOption) {
    return falseOption.label;
  }

  return matchedTrue ? question.options[0]?.label ?? null : question.options[1]?.label ?? null;
}

function extractLabelsFromChunk(question: ExamQuestion, chunk: string): string[] {
  const available = new Set(question.options.map((option) => option.label));
  const labels = Array.from(chunk.toUpperCase().matchAll(/[A-H]/g))
    .map((item) => item[0])
    .filter((label) => available.has(label));

  const deduped = Array.from(new Set(labels));
  if (deduped.length > 0) {
    return deduped;
  }

  if (question.questionType === "judgement") {
    const mapped = mapJudgementKeywordToLabel(question, chunk);
    if (mapped && available.has(mapped)) {
      return [mapped];
    }
  }

  return [];
}

export function matchAnswersFromText(
  questions: ExamQuestion[],
  answerText: string
): ExamAnswerMatch[] {
  const normalizedAnswerText = answerText.replace(/\u3000/g, " ");
  const matches: ExamAnswerMatch[] = [];

  for (let i = 0; i < questions.length; i += 1) {
    const question = questions[i];
    const byQuestion = normalizedAnswerText.match(buildQuestionRegex(question, i));

    let answerLabels = byQuestion ? extractLabelsFromChunk(question, byQuestion[1]) : [];
    if (answerLabels.length === 0) {
      const compactBlockRegex = new RegExp(
        `(?:^|\\n)\\s*(?:${question.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${i + 1})\\s*[).、:：-]*\\s*([A-H](?:\\s*[,，/、;+和与]\\s*[A-H])*)`,
        "i"
      );
      const compact = normalizedAnswerText.match(compactBlockRegex);
      if (compact?.[1]) {
        answerLabels = extractLabelsFromChunk(question, compact[1]);
      }
    }

    if (answerLabels.length === 0) {
      const byOption = question.options.find((option) => buildOptionRegex(option.label).test(normalizedAnswerText));
      if (byOption?.label) {
        answerLabels = [byOption.label];
      }
    }

    if (answerLabels.length === 0 && question.questionType === "judgement") {
      const mapped = mapJudgementKeywordToLabel(question, normalizedAnswerText);
      if (mapped) {
        answerLabels = [mapped];
      }
    }

    if (answerLabels.length === 0) {
      continue;
    }

    if (question.questionType !== "multiple") {
      answerLabels = [answerLabels[0]];
    }

    matches.push(
      answerLabels.length > 1
        ? {
            questionId: question.id,
            answerLabel: answerLabels[0],
            answerLabels
          }
        : {
            questionId: question.id,
            answerLabel: answerLabels[0]
          }
    );
  }

  return matches;
}