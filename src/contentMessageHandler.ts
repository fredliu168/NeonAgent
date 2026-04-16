import type { FeatureFlags } from "./shared/types.js";
import type { ExamAnswerMatch, ExamQuestion } from "./shared/types.js";

const defaultFeatureFlags: FeatureFlags = {
  unlockContextMenu: false,
  blockVisibilityDetection: false,
  aggressiveVisibilityBypass: false,
  enableFloatingBall: false
};

export function createContentMessageHandler(options?: {
  getContext?: () => string;
  applyFlags?: (flags: FeatureFlags) => void;
  getExamQuestions?: () => ExamQuestion[];
  applyExamAnswers?: (matches: ExamAnswerMatch[]) => { applied: number };
}) {
  const getContext = options?.getContext ?? (() => "");
  const applyFlags = options?.applyFlags ?? (() => {});
  const getExamQuestions = options?.getExamQuestions ?? (() => []);
  const applyExamAnswers = options?.applyExamAnswers ?? (() => ({ applied: 0 }));

  return (
    message: { type?: string; payload?: unknown },
    _sender: unknown,
    sendResponse: (response: unknown) => void
  ) => {
    if (message.type === "GET_PAGE_CONTEXT") {
      sendResponse({ ok: true, data: getContext() });
      return;
    }

    if (message.type === "APPLY_FEATURE_FLAGS") {
      const payload = message.payload as FeatureFlags | undefined;
      applyFlags(payload ?? defaultFeatureFlags);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "GET_EXAM_QUESTIONS") {
      sendResponse({ ok: true, data: getExamQuestions() });
      return;
    }

    if (message.type === "APPLY_EXAM_ANSWERS") {
      const payload = message.payload as { matches?: ExamAnswerMatch[] } | undefined;
      const result = applyExamAnswers(payload?.matches ?? []);
      sendResponse({ ok: true, data: result });
      return;
    }

    sendResponse({ ok: false, errors: ["Unknown message type"] });
  };
}
