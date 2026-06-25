const EXCEL_LOOKUP_MAX_MATCHES = 6;
const EXCEL_LOOKUP_MIN_SCORE = 8;
const EXCEL_LOOKUP_MAX_MATCHES_PER_BLOCK = 2;

const STOPWORDS = new Set([
  "题目",
  "单选",
  "多选",
  "判断",
  "请选择",
  "下列",
  "以下",
  "正确",
  "错误",
  "的是",
  "哪个",
  "关于",
  "根据",
  "说法",
  "选项",
  "答案",
  "题干",
  "question",
  "answer",
  "option",
  "options"
]);

interface ExcelReferenceCandidate {
  sheetName: string;
  line: string;
  compactLine: string;
}

interface QueryFeatures {
  compactQuery: string;
  phrases: string[];
  compactPhrases: string[];
  keywords: string[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactSearchText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function sanitizeQueryLine(value: string): string {
  return value
    .replace(/^\d+\.\s*/, "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^[A-Z]\./, "")
    .trim();
}

function extractQueryKeywords(value: string): string[] {
  const phrases = value
    .split(/\n+/)
    .map((line) => sanitizeQueryLine(line))
    .flatMap((line) => line.split(/[，。；：、,.!?！？（）()\[\]{}<>\-_/\\|\s]+/))
    .map((part) => normalizeWhitespace(part).toLowerCase())
    .filter((part) => part.length >= 2 && !STOPWORDS.has(part));

  return Array.from(new Set(phrases));
}

function buildQueryFeatures(queryText: string): QueryFeatures | null {
  const normalizedQuery = normalizeWhitespace(queryText);
  if (!normalizedQuery) {
    return null;
  }

  const compactQuery = compactSearchText(normalizedQuery);
  const keywords = extractQueryKeywords(normalizedQuery);
  const phrases = Array.from(new Set([
    ...normalizedQuery
      .split(/\n+/)
      .map((line) => sanitizeQueryLine(line))
      .filter((line) => line.length >= 4),
    ...keywords.filter((keyword) => keyword.length >= 4)
  ]));

  if (!compactQuery && phrases.length === 0 && keywords.length === 0) {
    return null;
  }

  return {
    compactQuery,
    phrases,
    compactPhrases: phrases.map((phrase) => compactSearchText(phrase)).filter(Boolean),
    keywords: keywords.map((keyword) => compactSearchText(keyword)).filter(Boolean)
  };
}

function longestCommonSubstringLength(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  const previous = new Array<number>(right.length + 1).fill(0);
  let maxLength = 0;

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = 0;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const currentTop = previous[rightIndex];
      if (left.charCodeAt(leftIndex - 1) === right.charCodeAt(rightIndex - 1)) {
        previous[rightIndex] = diagonal + 1;
        if (previous[rightIndex] > maxLength) {
          maxLength = previous[rightIndex];
        }
      } else {
        previous[rightIndex] = 0;
      }
      diagonal = currentTop;
    }
  }

  return maxLength;
}

function parseExcelReferenceCandidates(referenceText: string): ExcelReferenceCandidate[] {
  const lines = referenceText.split(/\r?\n/);
  let currentSheetName = "工作表";
  const candidates: ExcelReferenceCandidate[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith("Sheet: ")) {
      currentSheetName = line.slice("Sheet: ".length).trim() || currentSheetName;
      continue;
    }

    if (!line.startsWith("- ") || line.startsWith("- Note:")) {
      continue;
    }

    const compactLine = compactSearchText(line);
    if (!compactLine) {
      continue;
    }

    candidates.push({
      sheetName: currentSheetName,
      line,
      compactLine
    });
  }

  return candidates;
}

function splitQueryIntoBlocks(queryText: string): string[] {
  const normalized = queryText.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split("\n");
  const blocks: string[] = [];
  let currentLines: string[] = [];
  const questionStartPattern = /^\d+\.\s*\[[^\]]+\]/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (questionStartPattern.test(line)) {
      if (currentLines.length > 0) {
        blocks.push(currentLines.join("\n"));
      }
      currentLines = [line];
      continue;
    }

    if (currentLines.length === 0) {
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    blocks.push(currentLines.join("\n"));
  }

  return blocks;
}

function scoreCandidate(candidate: ExcelReferenceCandidate, features: QueryFeatures): number {
  let score = 0;

  if (features.compactQuery.length >= 6 && candidate.compactLine.includes(features.compactQuery)) {
    score += 160;
  }

  for (const compactPhrase of features.compactPhrases) {
    if (compactPhrase.length >= 4 && candidate.compactLine.includes(compactPhrase)) {
      score += 18;
      continue;
    }

    const overlap = longestCommonSubstringLength(compactPhrase, candidate.compactLine);
    if (overlap >= 8) {
      score += Math.min(30, overlap * 2);
    }
  }

  for (const keyword of features.keywords) {
    if (keyword.length >= 2 && candidate.compactLine.includes(keyword)) {
      score += keyword.length >= 4 ? 6 : 3;
      continue;
    }

    const overlap = longestCommonSubstringLength(keyword, candidate.compactLine);
    if (keyword.length >= 4 && overlap >= 4) {
      score += overlap;
    }
  }

  return score;
}

function rankCandidates(referenceText: string, queryText: string): Array<{ candidate: ExcelReferenceCandidate; score: number }> {
  const features = buildQueryFeatures(queryText);
  if (!features) {
    return [];
  }

  const candidates = parseExcelReferenceCandidates(referenceText);
  if (candidates.length === 0) {
    return [];
  }

  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, features)
    }))
    .filter((entry) => entry.score >= EXCEL_LOOKUP_MIN_SCORE)
    .sort((left, right) => right.score - left.score);
}

function buildExcelQueryLookupSummary(referenceText: string, queryText: string): string | undefined {
  const queryBlocks = splitQueryIntoBlocks(queryText);
  const blocks = queryBlocks.length > 1 ? queryBlocks : [queryText];
  const summaryLines = ["Excel grep 命中参考（按当前问题筛选）："];
  const seenLines = new Set<string>();
  let totalMatches = 0;

  for (const [index, block] of blocks.entries()) {
    if (totalMatches >= EXCEL_LOOKUP_MAX_MATCHES) {
      break;
    }

    const rankedMatches = rankCandidates(referenceText, block)
      .filter((entry) => !seenLines.has(entry.candidate.line))
      .slice(0, Math.min(EXCEL_LOOKUP_MAX_MATCHES_PER_BLOCK, EXCEL_LOOKUP_MAX_MATCHES - totalMatches));

    if (rankedMatches.length === 0) {
      continue;
    }

    if (blocks.length > 1) {
      summaryLines.push(`题目 ${index + 1}:`);
    }

    for (const entry of rankedMatches) {
      seenLines.add(entry.candidate.line);
      summaryLines.push(`- [${entry.candidate.sheetName}] ${entry.candidate.line.slice(2)}`);
      totalMatches += 1;
    }
  }

  if (totalMatches === 0) {
    return undefined;
  }

  return summaryLines.join("\n");
}

export function buildScopedExcelReferenceContext(
  searchReferenceText: string | undefined,
  queryText: string | undefined,
  fallbackReferenceText?: string | undefined
): string | undefined {
  const trimmedSearchReference = (searchReferenceText ?? "").trim();
  const trimmedFallbackReference = (fallbackReferenceText ?? searchReferenceText ?? "").trim();
  if (!trimmedSearchReference && !trimmedFallbackReference) {
    return undefined;
  }

  const trimmedQuery = (queryText ?? "").trim();
  if (!trimmedQuery) {
    return trimmedFallbackReference || trimmedSearchReference;
  }

  return (
    (
      buildExcelQueryLookupSummary(trimmedSearchReference, trimmedQuery)
      ?? trimmedFallbackReference
    )
    || trimmedSearchReference
  );
}

export function resolveReferenceConversationHistory(
  hasReferenceContext: boolean,
  requestedIncludeHistory?: boolean
): boolean {
  if (typeof requestedIncludeHistory === "boolean") {
    return requestedIncludeHistory;
  }

  return !hasReferenceContext;
}