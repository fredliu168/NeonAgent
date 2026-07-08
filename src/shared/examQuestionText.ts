function normalizeExamText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function stripLeadingQuestionNavigator(text: string): string {
  const patterns = [
    /^(?:题目[:：]\s*)?(?:\d{1,3}\s+){1,40}(?=(?:\[\s*(?:单选|多选|判断|简答|综合)\s*\]|(?:单选题|多选题|判断题|简答题|综合题)\s*\[\s*\d+\s*\]|交卷))/i,
    /^(?:\[\s*(?:单选|多选|判断|简答|综合)\s*\]\s*)?(?:\[\s*\d+\s*\]\s*)?(?:(?:单选题|多选题|判断题|简答题|综合题)\s*\[\s*\d+\s*\]\s*){2,}交卷\s*/i,
    /^(?:[A-H][.、:)）]?\s*(?:单选题|多选题|判断题|简答题|综合题)\s*\[\s*\d+\s*\]\s*){2,}/i
  ];

  let next = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const replaced = next.replace(pattern, "");
      if (replaced !== next) {
        next = normalizeExamText(replaced);
        changed = true;
      }
    }
  }

  return next;
}

function isQuestionNavigatorOnly(text: string): boolean {
  const normalized = normalizeExamText(text)
    .replace(/^题目[:：]\s*/i, "")
    .trim();

  if (!normalized) {
    return false;
  }

  return /^(?:(?:\d{1,3}|\[\s*(?:单选|多选|判断|简答|综合)\s*\]|\[\s*\d+\s*\]|(?:单选题|多选题|判断题|简答题|综合题)\s*\[\s*\d+\s*\]|交卷|[A-H][.、:)）]?)\s*)+$/i.test(normalized);
}

function isExamUiHint(text: string): boolean {
  const normalized = normalizeExamText(text)
    .replace(/^题目[:：]\s*/i, "")
    .replace(/^\[\s*(?:单选|多选|判断|简答|综合)\s*\]\s*/i, "")
    .trim();

  if (!normalized) {
    return false;
  }

  return /(?:推荐使用微信文件传输助手|文件传输助手传输答案照片|传输答案照片到电脑|上传答案照片|拍照上传答案|扫码上传答案)/i.test(normalized);
}

function sliceFromLastQuestionMarker(text: string): string {
  const markerRegex = /(^|\s)((?:第?\s*)?\d{1,3}\s*[.、)）:：-]\s*)/g;
  let lastStart = -1;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(text)) !== null) {
    lastStart = (match.index ?? 0) + (match[1]?.length ?? 0);
  }

  return lastStart > 0 ? text.slice(lastStart) : text;
}

function stripLeadingExamChrome(text: string): string {
  const patterns = [
    /^本卷共\s*\d+\s*题[^A-Za-z\u4e00-\u9fff]*总分\s*\d+\s*分\s*/i,
    /^已答[:：]?\s*\d+\s*/i,
    /^未答[:：]?\s*\d+\s*/i,
    /^我要交卷\s*/i,
    /^正在作答[:：]?\s*["“”'‘’]?[^"“”'‘’]+["“”'‘’]?\s*/i,
    /^(?:单选题|多选题|判断题)\s*[\(（]\s*\d+\s*\/\s*\d+\s*[\)）]\s*/i,
    /^本题分数[:：]?\s*\d+\s*/i,
    /^待检查\s*/i
  ];

  let next = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const replaced = next.replace(pattern, "");
      if (replaced !== next) {
        next = normalizeExamText(replaced);
        changed = true;
      }
    }
  }

  return next;
}

export function sanitizeExamStemText(rawText: string): string {
  let text = normalizeExamText(rawText);
  if (!text) {
    return "";
  }

  if (/^正在作答[:：]?/i.test(text) && !/(?:^|\s)(?:第?\s*)?[0-9]{1,3}\s*[.、)）:：-]\s*/.test(text)) {
    return "";
  }

  text = sliceFromLastQuestionMarker(text);
  text = stripLeadingQuestionNavigator(text);
  text = stripLeadingExamChrome(text);

  text = normalizeExamText(text
    .replace(/^\s*(?:第?\s*)?[0-9]{1,3}\s*[.、)）:：-]?\s*/, "")
    .replace(/^题目[:：]\s*/i, "")
    .replace(/已完成\s*\d+\s*\/\s*\d+\s*题/gi, "")
    .replace(/剩余[:：]?\s*\d{1,2}:\d{2}:\d{2}/gi, "")
    .replace(/座位号[:：]?\s*\S+/gi, "")
    .replace(/^(?:单选题|多选题|判断题)\s*/i, "")
    .replace(/^(?:本卷共|已答[:：]?|未答[:：]?|我要交卷|正在作答[:：]?)/i, "")
  );

  return isQuestionNavigatorOnly(text) || isExamUiHint(text) ? "" : text;
}
