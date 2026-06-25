function normalizeExamText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
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
  text = stripLeadingExamChrome(text);

  return normalizeExamText(text
    .replace(/^\s*(?:第?\s*)?[0-9]{1,3}\s*[.、)）:：-]?\s*/, "")
    .replace(/已完成\s*\d+\s*\/\s*\d+\s*题/gi, "")
    .replace(/剩余[:：]?\s*\d{1,2}:\d{2}:\d{2}/gi, "")
    .replace(/座位号[:：]?\s*\S+/gi, "")
    .replace(/^(?:单选题|多选题|判断题)\s*/i, "")
    .replace(/^(?:本卷共|已答[:：]?|未答[:：]?|我要交卷|正在作答[:：]?)/i, "")
  );
}
