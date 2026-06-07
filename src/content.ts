type FeatureFlags = {
  unlockContextMenu: boolean;
  blockVisibilityDetection: boolean;
  aggressiveVisibilityBypass: boolean;
  blockFullscreenRequests: boolean;
  enableFloatingBall: boolean;
};

type LLMConfig = {
  translationEnabled: boolean;
  selectionTranslationEnabled: boolean;
  translationTargetLanguage: string;
  translationDisplayMode: "replace" | "bilingual" | "below" | "hover";
  translationStyleColor: string;
  translationStyleBackground: string;
  translationStyleFontSize: number;
  translationStyleBold: boolean;
  translationStyleItalic: boolean;
  translationDebounceMs: number;
  translationBatchSize: number;
  unlockContextMenu: boolean;
  blockVisibilityDetection: boolean;
  aggressiveVisibilityBypass: boolean;
  blockFullscreenRequests: boolean;
  autoSolveCurrentPage: boolean;
  enableFloatingBall: boolean;
};

type ExamQuestion = {
  id: string;
  stem: string;
  options: Array<{ label: string; text: string }>;
  questionType?: "single" | "multiple" | "judgement";
};

type ExamAnswerMatch = {
  questionId: string;
  answerLabel: string;
  answerLabels?: string[];
};

type EventTargetLike = {
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => void;
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ) => void;
};

type StyleTargetLike = {
  style: {
    userSelect: string;
    webkitUserSelect: string;
  };
};

type StyleElementLike = {
  id: string;
  textContent: string | null;
  remove: () => void;
};

type StyleContainerLike = {
  appendChild: (node: unknown) => unknown;
};

type StyleHostLike = {
  getElementById: (id: string) => StyleElementLike | null;
  createElement: (tagName: string) => StyleElementLike;
  head?: StyleContainerLike;
  documentElement?: StyleContainerLike;
  body?: StyleContainerLike;
};

type FullscreenDocumentLike = EventTargetLike & {
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  mozFullScreenElement?: unknown;
  msFullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

const SELECTION_UNLOCK_STYLE_ID = "neonagent-selection-unlock-style";
const SELECTION_UNLOCK_CSS =
  "html, body, * { user-select: text !important; -webkit-user-select: text !important; }";

function addCaptureBlocker(target: EventTargetLike, event: string): () => void {
  const handler = (e: Event) => {
    e.stopImmediatePropagation();
  };

  target.addEventListener(event, handler, true);
  return () => target.removeEventListener(event, handler, true);
}

function addAggressiveCaptureBlocker(target: EventTargetLike, event: string): () => void {
  const handler = (e: Event) => {
    e.stopImmediatePropagation();
    e.stopPropagation();

    if (e.cancelable) {
      e.preventDefault();
    }

    (e as Event & { returnValue?: boolean }).returnValue = false;
    (e as Event & { cancelBubble?: boolean }).cancelBubble = true;
  };

  target.addEventListener(event, handler, true);
  return () => target.removeEventListener(event, handler, true);
}

function overrideProperty(
  target: object,
  key: "visibilityState" | "hidden",
  value: string | boolean
): () => void {
  const ownDescriptor = Object.getOwnPropertyDescriptor(target, key);

  try {
    Object.defineProperty(target, key, {
      configurable: true,
      get: () => value
    });
  } catch {
    return () => {
      // ignored
    };
  }

  return () => {
    try {
      if (ownDescriptor) {
        Object.defineProperty(target, key, ownDescriptor);
      } else {
        delete (target as Record<string, unknown>)[key];
      }
    } catch {
      // ignored
    }
  };
}

function overrideFunction<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K]
): () => void {
  const ownDescriptor = Object.getOwnPropertyDescriptor(target, key);

  try {
    Object.defineProperty(target, key, {
      configurable: true,
      value
    });
  } catch {
    return () => {
      // ignored
    };
  }

  return () => {
    try {
      if (ownDescriptor) {
        Object.defineProperty(target, key, ownDescriptor);
      } else {
        delete (target as Record<string, unknown>)[key as string];
      }
    } catch {
      // ignored
    }
  };
}

function relaxSelectionStyle(target: StyleTargetLike): () => void {
  const prevUserSelect = target.style.userSelect;
  const prevWebkitUserSelect = target.style.webkitUserSelect;

  target.style.userSelect = "text";
  target.style.webkitUserSelect = "text";

  return () => {
    target.style.userSelect = prevUserSelect;
    target.style.webkitUserSelect = prevWebkitUserSelect;
  };
}

function injectSelectionUnlockStyle(host: StyleHostLike): () => void {
  const existing = host.getElementById(SELECTION_UNLOCK_STYLE_ID);
  if (existing) {
    return () => {
      // style already exists, do not remove styles added by others
    };
  }

  const styleEl = host.createElement("style");
  styleEl.id = SELECTION_UNLOCK_STYLE_ID;
  styleEl.textContent = SELECTION_UNLOCK_CSS;

  const container = host.head ?? host.documentElement ?? host.body;
  if (!container) {
    return () => {
      // ignored
    };
  }

  container.appendChild(styleEl);
  return () => styleEl.remove();
}

function createContextMenuUnlockRuntime(input: {
  windowTarget: EventTargetLike;
  documentTarget: EventTargetLike;
  rootTarget?: EventTargetLike;
  styleTarget?: StyleTargetLike;
  styleHost?: StyleHostLike;
}): () => void {
  const events = ["contextmenu", "copy", "paste", "selectstart"];
  const targets = [input.windowTarget, input.documentTarget];
  if (input.rootTarget) {
    targets.push(input.rootTarget);
  }

  const cleaners: Array<() => void> = [];
  for (const target of targets) {
    for (const event of events) {
      cleaners.push(addCaptureBlocker(target, event));
    }
  }

  if (input.styleTarget) {
    cleaners.push(relaxSelectionStyle(input.styleTarget));
  }

  if (input.styleHost) {
    cleaners.push(injectSelectionUnlockStyle(input.styleHost));
  }

  return () => {
    cleaners.forEach((fn) => fn());
  };
}

function createVisibilityBypassRuntime(input: {
  documentTarget: EventTargetLike;
  windowTarget: EventTargetLike;
  visibilityHost: object;
  aggressive?: boolean;
}): () => void {
  const cleaners: Array<() => void> = [];

  const documentEvents = [
    "visibilitychange",
    "webkitvisibilitychange",
    "mozvisibilitychange",
    "msvisibilitychange"
  ];
  const windowEvents = ["blur", "focus", "pagehide", "freeze"];

  for (const event of documentEvents) {
    cleaners.push(addCaptureBlocker(input.documentTarget, event));
  }

  for (const event of windowEvents) {
    cleaners.push(addCaptureBlocker(input.windowTarget, event));
  }

  cleaners.push(overrideProperty(input.visibilityHost, "visibilityState", "visible"));
  cleaners.push(overrideProperty(input.visibilityHost, "hidden", false));
  cleaners.push(
    overrideFunction(
      input.visibilityHost as { hasFocus?: () => boolean },
      "hasFocus",
      (() => true) as () => boolean
    )
  );

  if (input.aggressive) {
    for (const event of documentEvents) {
      cleaners.push(addAggressiveCaptureBlocker(input.documentTarget, event));
    }

    for (const event of windowEvents) {
      cleaners.push(addAggressiveCaptureBlocker(input.windowTarget, event));
    }

    cleaners.push(
      overrideFunction(input.windowTarget as { onblur?: EventListener | null }, "onblur", null)
    );
    cleaners.push(
      overrideFunction(input.windowTarget as { onfocus?: EventListener | null }, "onfocus", null)
    );
    cleaners.push(
      overrideFunction(input.windowTarget as { onpagehide?: EventListener | null }, "onpagehide", null)
    );
    cleaners.push(
      overrideFunction(input.windowTarget as { onfreeze?: EventListener | null }, "onfreeze", null)
    );
    cleaners.push(
      overrideFunction(
        input.documentTarget as { onvisibilitychange?: EventListener | null },
        "onvisibilitychange",
        null
      )
    );
  }

  return () => {
    cleaners.forEach((fn) => fn());
  };
}

const FLOATING_BALL_ID = "neonagent-floating-ball";
const FULLSCREEN_BLOCK_EVENT = "neonagent:set-fullscreen-block";
const TRANSLATION_SOURCE_ATTR = "data-neonagent-translation-source";
const TRANSLATION_HOST_ATTR = "data-neonagent-translation-host";
const TRANSLATION_TEXT_ATTR = "data-neonagent-translation-text";
const SELECTION_TRANSLATION_POPUP_ATTR = "data-neonagent-selection-translation";

type TranslationSettings = {
  enabled: boolean;
  selectionEnabled: boolean;
  targetLanguage: string;
  displayMode: "replace" | "bilingual";
  styleColor: string;
  styleBackground: string;
  styleFontSize: number;
  styleBold: boolean;
  styleItalic: boolean;
  debounceMs: number;
  batchSize: number;
};

type TranslationRecord = {
  id: string;
  source: HTMLElement;
  host: HTMLDivElement;
  body: HTMLDivElement;
  sourceText: string;
  translatedText: string;
  overlay: boolean;
  displayMode?: "below" | "hover";
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  lastRenderedSourceText?: string;
  lastRenderedTranslatedText?: string;
  lastRenderedDisplayMode?: TranslationSettings["displayMode"];
  lastRenderedStyleSignature?: string;
};

const defaultFeatureFlags: FeatureFlags = {
  unlockContextMenu: false,
  blockVisibilityDetection: false,
  aggressiveVisibilityBypass: false,
  blockFullscreenRequests: false,
  enableFloatingBall: false
};

const defaultTranslationSettings: TranslationSettings = {
  enabled: false,
  selectionEnabled: false,
  targetLanguage: "中文",
  displayMode: "replace",
  styleColor: "#0f172a",
  styleBackground: "#f8fafc",
  styleFontSize: 14,
  styleBold: false,
  styleItalic: false,
  debounceMs: 600,
  batchSize: 8
};

const cleanupFns: Array<() => void> = [];
const translationRecords = new Map<string, TranslationRecord>();
let translationSettings: TranslationSettings = { ...defaultTranslationSettings };
let translationObserver: MutationObserver | null = null;
let translationTimer: ReturnType<typeof setTimeout> | null = null;
let translationRunId = 0;
let translationCounter = 0;
let suppressTranslationObserver = false;
let lastPageTranslationSignature = "";
let pageTranslationInProgressSignature = "";
let selectionTranslationCleanup: (() => void) | null = null;
let selectionTranslationPopup: HTMLDivElement | null = null;
let selectionTranslationRunId = 0;
let lastSelectionTranslationKey = "";
let autoSolveCurrentPageEnabled = false;
let autoSolveObserver: MutationObserver | null = null;
let autoSolveTimer: ReturnType<typeof setTimeout> | null = null;
let autoSolveAttachTimer: ReturnType<typeof setTimeout> | null = null;
let lastAutoSolveQuestionSignature = "";
const sentAutoSolveSignatures = new Set<string>();

function buildPageContext(): string {
  const title = document.title || "Untitled";
  const selected = window.getSelection()?.toString().trim() || "";
  const text = selected || document.body?.innerText?.slice(0, 800) || "";

  return `Title: ${title}\n\nContext:\n${text}`.trim();
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function uniqueElements(nodes: HTMLElement[]): HTMLElement[] {
  return Array.from(new Set(nodes));
}

function buildAutoTranslationRenderStyleSignature(settings: TranslationSettings): string {
  return [
    settings.displayMode,
    settings.styleColor,
    settings.styleBackground,
    settings.styleFontSize,
    settings.styleBold ? "bold" : "normal",
    settings.styleItalic ? "italic" : "normal"
  ].join("|");
}

function hasInteractiveOptionNodes(node: HTMLElement): boolean {
  return node.querySelectorAll(
    "input[type='radio'], input[type='checkbox'], label, [role='radio'], [role='checkbox'], .a-radio, .a-checkbox"
  ).length >= 2;
}

function resolveExamQuestionRoots(): HTMLElement[] {
  const explicit = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".question-item, .question, .topic, .problem, .quiz-question, .exam-question"
    )
  );
  const generic = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "[data-question-id]",
        "[data-question]",
        '[class*="question" i]',
        '[id*="question" i]',
        '[class*="topic" i]',
        '[id*="topic" i]',
        '[class*="subject" i]',
        '[class*="problem" i]',
        '[class*="quiz" i]',
        '[class*="exam" i]',
        '[class*="ques" i]'
      ].join(",")
    )
  );
  const textLike = Array.from(document.querySelectorAll<HTMLElement>("li, section, article, div, form"))
    .filter((node) => {
      const text = normalizeText(node.innerText || "");
      if (text.length < 12 || text.length > 6000) {
        return false;
      }
      return (
        /(?:^|\s)[0-9]{1,3}[.、)）]\s*/.test(text) ||
        /(?:单选|多选|判断|题目|请选择|以下|下列)/.test(text)
      ) && (countOptionMarkers(text) >= 2 || hasInteractiveOptionNodes(node));
    });

  return uniqueElements([...explicit, ...generic, ...textLike])
    .filter((node) => {
      const text = normalizeText(node.innerText || "");
      if (text.length < 8 || text.length > 8000) {
        return false;
      }
      const hasOptionNodes = node.querySelectorAll(
        ".question-attrs-wrap .a-radio, .question-attrs-wrap .a-checkbox, [data-option], [class*='option' i], .answer-item, li, label"
      ).length >= 2 || hasInteractiveOptionNodes(node);
      return hasOptionNodes || countOptionMarkers(text) >= 2;
    })
    .slice(0, 60);
}

function parseOptionTextFromNode(el: HTMLElement): string | null {
  const raw = normalizeText(el.innerText || "");
  if (!raw) {
    return null;
  }

  // Strip ALL leading label-like prefixes so "A B. text", "B A. text", "A. A. E. text" all
  // resolve to the bare content. We do NOT trust the DOM labels because exam sites often
  // render extra / shifted letters (prefix radios, accessibility spans, etc.).
  const text = normalizeText(raw.replace(/^(?:[A-H][.、:)）]?\s*)+/i, ""));
  return text || null;
}

function extractOptionsFromQuestionText(rawText: string): Array<{ label: string; text: string }> {
  const text = normalizeText(rawText);
  if (!text) {
    return [];
  }

  // Find every occurrence of "[A-H]." (or 、:)）) in normalized text.
  // When the DOM yields "X Y. content" style (prefix-letter before actual option letter),
  // the gap between X. and Y. is empty — those empty chunks are skipped below.
  // We assign sequential A, B, C, D… so labels are never shifted by prefix noise.
  const markerRegex = /(?:^|\s)([A-H])(?:[.、:)）]|\s+)/gi;
  const markers = Array.from(text.matchAll(markerRegex));
  if (markers.length < 2) {
    return [];
  }

  const options: Array<{ label: string; text: string }> = [];

  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const next = markers[i + 1];
    const start = (current.index ?? 0) + current[0].length;
    const end = next?.index ?? text.length;
    const chunk = normalizeText(text.slice(start, end));

    // Skip empty chunks — these are the gaps between a prefix letter and the
    // real option letter, e.g. the gap between "A." and "B." in "A B. text".
    if (!chunk) {
      continue;
    }

    // Sequential label regardless of what letters appear in the raw text.
    options.push({ label: String.fromCharCode(65 + options.length), text: chunk });
  }

  return options;
}

function countOptionMarkers(rawText: string): number {
  return Array.from(normalizeText(rawText).matchAll(/(?:^|\s)[A-H](?:[.、:)）]|\s+)/gi)).length;
}

function cleanExamStem(rawText: string): string {
  let text = normalizeText(rawText);

  if (text.length > 220) {
    const candidates = Array.from(text.matchAll(/(?:^|\s)\d{1,3}\s+([^\d\s][\s\S]*)/g))
      .map((match) => normalizeText(match[1] ?? ""))
      .filter((candidate) => /[\u4e00-\u9fffA-Za-z]/.test(candidate));
    const last = candidates.at(-1);
    if (last) {
      text = last;
    }
  }

  return normalizeText(text
    .replace(/^\s*(?:第?\s*)?[0-9]{1,3}\s*[.、)）:：-]?\s*/, "")
    .replace(/已完成\s*\d+\s*\/\s*\d+\s*题/gi, "")
    .replace(/剩余[:：]?\s*\d{1,2}:\d{2}:\d{2}/gi, "")
    .replace(/座位号[:：]?\s*\S+/gi, ""));
}

function stripQuestionNumber(rawText: string): string {
  return cleanExamStem(rawText);
}

function collectExamQuestionsFromText(rawText: string): ExamQuestion[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const startsQuestion = /^(?:第?\s*)?[0-9]{1,3}\s*[.、)）:：-]\s*/.test(line) && countOptionMarkers(line) >= 1;
    const standaloneQuestion = /^(?:第?\s*)?[0-9]{1,3}\s*[.、)）:：-]\s*/.test(line);

    if ((startsQuestion || standaloneQuestion) && current.length > 0 && countOptionMarkers(current.join(" ")) >= 2) {
      blocks.push(current.join(" "));
      current = [line];
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current.join(" "));
  }

  return blocks
    .map((block, index): ExamQuestion | null => {
      const options = extractOptionsFromQuestionText(block).slice(0, 8);
      if (options.length < 2) {
        return null;
      }

      const firstMarker = normalizeText(block).search(/(?:^|\s)[A-H](?:[.、:)）]|\s+)/i);
      const rawStem = firstMarker > 0 ? block.slice(0, firstMarker) : block;
      const stem = stripQuestionNumber(rawStem);
      if (!stem) {
        return null;
      }

      return {
        id: `q_${index + 1}`,
        stem,
        options,
        questionType: options.length === 2 && options.some((option) => /正确|错误|对|错|true|false/i.test(option.text))
          ? "judgement"
          : "single"
      } satisfies ExamQuestion;
    })
    .filter((question): question is ExamQuestion => !!question);
}

/**
 * Keep only the outermost (farthest-from-root) nodes in the set,
 * discarding any node whose ancestor is also in the set.
 * This removes container nodes that accidentally match a broad selector
 * while individual child option nodes are also in the set.
 */
function dedupeLeafNodes(nodes: HTMLElement[]): HTMLElement[] {
  return nodes.filter(
    (node) => !nodes.some((other) => other !== node && node.contains(other))
  );
}

function inferQuestionType(
  node: HTMLElement,
  options: Array<{ label: string; text: string }>
): "single" | "multiple" | "judgement" {
  const hasCheckboxGroup = !!node.querySelector(".a-checkbox-group, input[type='checkbox']");
  if (hasCheckboxGroup) {
    return "multiple";
  }

  const judgmentWords = ["正确", "错误", "对", "错", "true", "false", "yes", "no"];
  const judgementOptionCount = options.filter((option) => {
    const normalized = option.text.toLowerCase();
    return judgmentWords.some((word) => normalized.includes(word));
  }).length;

  if (options.length === 2 && judgementOptionCount >= 1) {
    return "judgement";
  }

  return "single";
}

function collectExamQuestionsFromPage(): ExamQuestion[] {
  const questionNodes = resolveExamQuestionRoots();

  const result: ExamQuestion[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < questionNodes.length; i += 1) {
    const node = questionNodes[i];

    // --- Stem extraction ---
    // Prefer a dedicated title element; otherwise cut the full innerText at the
    // point where the first option letter ("A." / "A、" …) starts so that we
    // never include option content in the stem.
    const titleNode = node.querySelector<HTMLElement>(
      ".question-title, .stem, .title, h1, h2, h3"
    );
    let rawStem = titleNode?.innerText ?? "";
    if (!rawStem) {
      const fullText = node.innerText || "";
      // Match the first standalone option letter preceded by whitespace
      const cut = fullText.search(/(?:^|[\s\n\r\t])[A-H](?:[.、:)）]|\s+)/i);
      rawStem = cut > 0 ? fullText.slice(0, cut) : fullText;
    }
    const stem = stripQuestionNumber(rawStem);

    // --- Option node collection ---
    // Scoped: prefer explicit exam-widget option containers; exclude <label>
    // sub-elements (they contain only the letter and cause duplicates).
    const scopedOptionNodes = Array.from(
      node.querySelectorAll<HTMLElement>(
        ".question-attrs-wrap .a-radio, .question-attrs-wrap .a-checkbox, .question-attrs-wrap li, label"
      )
    );

    // Generic fallback: broad selector; apply leaf-dedup so that when both a
    // container (e.g. .options > .option) and its children are matched, only
    // the innermost nodes are kept.
    const genericOptionNodes = dedupeLeafNodes(
      Array.from(
        node.querySelectorAll<HTMLElement>(
          '[data-option], [class*="option" i], .answer-item, .item, li'
        )
      )
    );

    const optionNodes = scopedOptionNodes.length > 0 ? scopedOptionNodes : genericOptionNodes;
    // Parse text from each node, filter out prefix-only / empty nodes,
    // then assign sequential labels A, B, C, D… AFTER filtering.
    const nodeOptions = optionNodes
      .map((el) => parseOptionTextFromNode(el))
      .filter((text): text is string => !!text)
      .map((text, idx) => ({ label: String.fromCharCode(65 + idx), text }))
      .slice(0, 8);

    // Fall back to text-based extraction when DOM nodes are too few or all empty.
    const textOptions = nodeOptions.length < 2
      ? extractOptionsFromQuestionText(node.innerText || "").slice(0, 8)
      : [];
    const options = nodeOptions.length >= 2 ? nodeOptions : textOptions.length >= 2 ? textOptions : nodeOptions;

    if (!stem || options.length < 2) {
      continue;
    }

    const key = `${stem}::${options.map((option) => option.text).join("|")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    result.push({
      id: node.dataset.questionId || `q_${i + 1}`,
      stem,
      options,
      questionType: inferQuestionType(node, options)
    });
  }

  if (result.length > 0) {
    return result;
  }

  return collectExamQuestionsFromText(document.body?.innerText || "");
}

function buildExamQuestionSignature(questions: ExamQuestion[]): string {
  return questions
    .map((question) => {
      const type = question.questionType ?? "single";
      return `${normalizeText(question.stem)}::${type}::${question.options.length}`;
    })
    .join("\n")
    .slice(0, 12000);
}

function requestAutoSolveCurrentPage(reason: string): void {
  if (!autoSolveCurrentPageEnabled) {
    return;
  }

  const questions = collectExamQuestionsFromPage();
  if (questions.length === 0) {
    return;
  }

  const signature = buildExamQuestionSignature(questions);
  if (!signature || signature === lastAutoSolveQuestionSignature || sentAutoSolveSignatures.has(signature)) {
    return;
  }
  lastAutoSolveQuestionSignature = signature;
  sentAutoSolveSignatures.add(signature);
  if (sentAutoSolveSignatures.size > 50) {
    const oldest = sentAutoSolveSignatures.values().next().value;
    if (oldest) {
      sentAutoSolveSignatures.delete(oldest);
    }
  }

  const runtime = getChromeRuntime();
  if (!runtime?.sendMessage) {
    applyAutoSolveCurrentPage(false);
    return;
  }

  try {
    void runtime.sendMessage({
      type: "AUTO_SOLVE_CURRENT_PAGE_REQUEST",
      payload: {
        questionCount: questions.length,
        signature,
        reason,
        title: document.title,
        url: location.href
      }
    }).catch((error) => {
      if (isExtensionContextInvalidated(error)) {
        applyAutoSolveCurrentPage(false);
      }
    });
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      applyAutoSolveCurrentPage(false);
    }
  }
}

function scheduleAutoSolveCurrentPage(reason: string): void {
  if (!autoSolveCurrentPageEnabled) {
    return;
  }

  if (autoSolveTimer) {
    clearTimeout(autoSolveTimer);
  }

  autoSolveTimer = setTimeout(() => {
    autoSolveTimer = null;
    requestAutoSolveCurrentPage(reason);
  }, 900);
}

function applyAutoSolveCurrentPage(enabled: boolean): void {
  autoSolveCurrentPageEnabled = enabled;

  if (!enabled) {
    if (autoSolveTimer) {
      clearTimeout(autoSolveTimer);
      autoSolveTimer = null;
    }
    if (autoSolveAttachTimer) {
      clearTimeout(autoSolveAttachTimer);
      autoSolveAttachTimer = null;
    }
    autoSolveObserver?.disconnect();
    autoSolveObserver = null;
    lastAutoSolveQuestionSignature = "";
    sentAutoSolveSignatures.clear();
    return;
  }

  attachAutoSolveObserver();
  scheduleAutoSolveCurrentPage("enabled");
}

function attachAutoSolveObserver(): void {
  if (!autoSolveCurrentPageEnabled || autoSolveObserver) {
    return;
  }

  if (!document.body) {
    if (!autoSolveAttachTimer) {
      autoSolveAttachTimer = setTimeout(() => {
        autoSolveAttachTimer = null;
        attachAutoSolveObserver();
        scheduleAutoSolveCurrentPage("body_ready_retry");
      }, 500);
    }
    return;
  }

  autoSolveObserver = new MutationObserver(() => {
    scheduleAutoSolveCurrentPage("page_mutation");
  });
  autoSolveObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
  scheduleAutoSolveCurrentPage("observer_attached");
}

function applyExamAnswersToPage(matches: ExamAnswerMatch[]): { applied: number } {
  let applied = 0;
  const questionRoots = resolveExamQuestionRoots();

  for (const match of matches) {
    const orderMatch = match.questionId.match(/^q_(\d+)$/i);
    const orderIndex = orderMatch ? Number(orderMatch[1]) - 1 : -1;

    const labels = Array.from(new Set(match.answerLabels ?? [match.answerLabel])).filter((label) => !!label);

    const root =
      document.querySelector<HTMLElement>(`[data-question-id="${match.questionId}"]`) ||
      document.querySelector<HTMLElement>(`#${match.questionId}`) ||
      document.querySelector<HTMLElement>(`[id*="${match.questionId}"]`) ||
      (orderIndex >= 0 ? questionRoots[orderIndex] ?? null : null) ||
      null;

    const searchRoot = root ?? document;

    // Use the same two-tier selector strategy as collection.
    // After leaf-dedup, candidates are ordered by DOM position (option 0 = A, 1 = B …)
    // so we can click by index rather than by label text — this is immune to DOM label noise.
    const scopedCandidatesForFill = Array.from(
      searchRoot.querySelectorAll<HTMLElement>(
        ".question-attrs-wrap .a-radio, .question-attrs-wrap .a-checkbox, .question-attrs-wrap li"
      )
    );
    const genericCandidatesForFill = dedupeLeafNodes(
      Array.from(
        searchRoot.querySelectorAll<HTMLElement>(
          '[data-option], [class*="option" i], .answer-item, .item, li'
        )
      )
    );
    const leafCandidates =
      scopedCandidatesForFill.length > 0 ? scopedCandidatesForFill : genericCandidatesForFill;

    // Filter out prefix-only nodes (nodes whose text, after stripping leading
    // label characters, is empty) so that index 0 = first real option, matching
    // the sequential A/B/C/D labels assigned during collection.
    const contentCandidates = leafCandidates.filter((el) => !!parseOptionTextFromNode(el));

    for (const label of labels) {
      // Convert letter to 0-based index: A→0, B→1, C→2, D→3 …
      const labelIndex = label.toUpperCase().charCodeAt(0) - 65;
      const target = labelIndex >= 0 && labelIndex < contentCandidates.length
        ? contentCandidates[labelIndex]
        : null;

      if (!target) {
        continue;
      }

      // Click the wrapper element — most exam-site frameworks handle clicks on
      // the wrapper (.a-radio / .a-checkbox), not on the hidden inner <input>.
      target.click();

      // If the underlying input is still not checked, force it and fire events
      // so that frameworks (Vue / React / custom) pick up the state change.
      const input = target.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
      if (input && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      applied += 1;
    }
  }

  return { applied };
}

function enableContextMenuUnlock(): () => void {
  const styleHost: StyleHostLike = {
    getElementById: (id) => {
      const el = document.getElementById(id);
      return (el as unknown as StyleElementLike | null) ?? null;
    },
    createElement: (tagName) => {
      return document.createElement(tagName) as unknown as StyleElementLike;
    },
    head: document.head
      ? {
          appendChild: (node) => document.head?.appendChild(node as Node)
        }
      : undefined,
    documentElement: document.documentElement
      ? {
          appendChild: (node) => document.documentElement.appendChild(node as Node)
        }
      : undefined,
    body: document.body
      ? {
          appendChild: (node) => document.body?.appendChild(node as Node)
        }
      : undefined
  };

  return createContextMenuUnlockRuntime({
    windowTarget: window,
    documentTarget: document,
    rootTarget: document.documentElement,
    styleTarget: document.documentElement,
    styleHost
  });
}

function enableVisibilityBypass(aggressive = false): () => void {
  return createVisibilityBypassRuntime({
    documentTarget: document,
    windowTarget: window,
    visibilityHost: document,
    aggressive
  });
}

function enableFullscreenBlock(): () => void {
  const blockedRequest = (() => Promise.reject(new DOMException("Fullscreen requests are blocked by NeonAgent", "NotAllowedError"))) as () => Promise<void>;
  const requestMethods = [
    "requestFullscreen",
    "webkitRequestFullscreen",
    "webkitRequestFullScreen",
    "mozRequestFullScreen",
    "msRequestFullscreen"
  ] as const;
  const cleaners: Array<() => void> = [];
  const elementPrototype = Element.prototype as unknown as Record<string, unknown>;

  for (const method of requestMethods) {
    if (method in elementPrototype) {
      cleaners.push(overrideFunction(elementPrototype, method, blockedRequest));
    }
  }

  const exitFullscreen = (): void => {
    const doc = document as FullscreenDocumentLike;
    const isFullscreen = Boolean(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );
    if (!isFullscreen) return;

    try {
      const exit =
        doc.exitFullscreen ??
        doc.webkitExitFullscreen ??
        doc.mozCancelFullScreen ??
        doc.msExitFullscreen;
      void exit?.call(doc);
    } catch {
      // ignored
    }
  };

  const fullscreenEvents = [
    "fullscreenchange",
    "webkitfullscreenchange",
    "mozfullscreenchange",
    "MSFullscreenChange"
  ];
  for (const event of fullscreenEvents) {
    document.addEventListener(event, exitFullscreen, true);
    cleaners.push(() => document.removeEventListener(event, exitFullscreen, true));
  }

  exitFullscreen();

  return () => {
    cleaners.forEach((fn) => fn());
  };
}

function setFloatingBall(enabled: boolean): void {
  const existing = document.getElementById(FLOATING_BALL_ID);

  if (!enabled) {
    existing?.remove();
    return;
  }

  if (existing) {
    return;
  }

  const btn = document.createElement("button");
  btn.id = FLOATING_BALL_ID;
  btn.textContent = "OA";
  btn.style.position = "fixed";
  btn.style.right = "16px";
  btn.style.bottom = "16px";
  btn.style.width = "44px";
  btn.style.height = "44px";
  btn.style.borderRadius = "50%";
  btn.style.border = "0";
  btn.style.background = "#0f766e";
  btn.style.color = "#fff";
  btn.style.cursor = "pointer";
  btn.style.zIndex = "2147483647";
  btn.title = "NeonAgent";
  document.documentElement.appendChild(btn);
}

function syncMainWorldFullscreenBlock(enabled: boolean): void {
  window.dispatchEvent(new CustomEvent(FULLSCREEN_BLOCK_EVENT, {
    detail: { enabled }
  }));
}

function applyFeatureFlags(flags: FeatureFlags): void {
  while (cleanupFns.length > 0) {
    const fn = cleanupFns.pop();
    if (fn) {
      fn();
    }
  }

  if (flags.unlockContextMenu) {
    cleanupFns.push(enableContextMenuUnlock());
  }

  if (flags.blockVisibilityDetection) {
    cleanupFns.push(enableVisibilityBypass(flags.aggressiveVisibilityBypass));
  }

  if (flags.blockFullscreenRequests) {
    cleanupFns.push(enableFullscreenBlock());
  }
  syncMainWorldFullscreenBlock(flags.blockFullscreenRequests);

  setFloatingBall(flags.enableFloatingBall);
}

function flagsFromConfig(config: Partial<LLMConfig>): FeatureFlags {
  return {
    unlockContextMenu: !!config.unlockContextMenu,
    blockVisibilityDetection: !!config.blockVisibilityDetection,
    aggressiveVisibilityBypass: !!config.aggressiveVisibilityBypass,
    blockFullscreenRequests: !!config.blockFullscreenRequests,
    enableFloatingBall: !!config.enableFloatingBall
  };
}

function translationSettingsFromConfig(config: Partial<LLMConfig>): TranslationSettings {
  const targetLanguage = typeof config.translationTargetLanguage === "string" && config.translationTargetLanguage.trim()
    ? config.translationTargetLanguage.trim()
    : defaultTranslationSettings.targetLanguage;

  return {
    enabled: !!config.translationEnabled,
    selectionEnabled: !!config.selectionTranslationEnabled,
    targetLanguage,
    displayMode: config.translationDisplayMode === "bilingual" ||
      config.translationDisplayMode === "below" ||
      config.translationDisplayMode === "hover"
      ? "bilingual"
      : "replace",
    styleColor: typeof config.translationStyleColor === "string" && config.translationStyleColor.trim()
      ? config.translationStyleColor.trim()
      : defaultTranslationSettings.styleColor,
    styleBackground: typeof config.translationStyleBackground === "string" && config.translationStyleBackground.trim()
      ? config.translationStyleBackground.trim()
      : defaultTranslationSettings.styleBackground,
    styleFontSize: typeof config.translationStyleFontSize === "number" && config.translationStyleFontSize > 0
      ? config.translationStyleFontSize
      : defaultTranslationSettings.styleFontSize,
    styleBold: !!config.translationStyleBold,
    styleItalic: !!config.translationStyleItalic,
    debounceMs: typeof config.translationDebounceMs === "number" && config.translationDebounceMs >= 0
      ? Math.round(config.translationDebounceMs)
      : defaultTranslationSettings.debounceMs,
    batchSize: typeof config.translationBatchSize === "number" && config.translationBatchSize > 0
      ? Math.round(config.translationBatchSize)
      : defaultTranslationSettings.batchSize
  };
}

function isTranslationHost(node: Element | null): boolean {
  return !!node?.hasAttribute?.(TRANSLATION_HOST_ATTR);
}

function hasTranslationBlockDescendant(node: HTMLElement): boolean {
  if (typeof node.querySelector !== "function") {
    return false;
  }
  return node.querySelector(`[${TRANSLATION_HOST_ATTR}]`) !== null;
}

function isTranslatableElement(node: HTMLElement): boolean {
  const tag = node.tagName.toLowerCase();
  const allowedTags = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "figcaption", "td", "th"]);
  if (!allowedTags.has(tag)) {
    return false;
  }

  if (node.closest("pre, code, nav, header, footer, aside, script, style, noscript, textarea, button, input, select")) {
    return false;
  }

  if (isTranslationHost(node) || node.closest(`[${TRANSLATION_HOST_ATTR}]`)) {
    return false;
  }

  if (hasTranslationBlockDescendant(node)) {
    return false;
  }

  const text = normalizeText(node.innerText || node.textContent || "");
  return text.length >= 2;
}

function collectTranslatableElements(): HTMLElement[] {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th")
  ).filter((node) => isTranslatableElement(node));
  const candidateSet = new Set(candidates);

  return candidates.filter((node) => {
    let parent = node.parentElement;
    while (parent) {
      if (candidateSet.has(parent as HTMLElement)) {
        return false;
      }
      parent = parent.parentElement;
    }
    return true;
  });
}

function ensureTranslationId(node: HTMLElement): string {
  const existing = node.getAttribute(TRANSLATION_SOURCE_ATTR);
  if (existing) {
    return existing;
  }

  translationCounter += 1;
  const id = `neonagent-translation-${translationCounter}`;
  node.setAttribute(TRANSLATION_SOURCE_ATTR, id);
  return id;
}

function removeTranslationRecord(id: string): void {
  const record = translationRecords.get(id);
  if (!record) {
    return;
  }

  if (record.onMouseEnter) {
    record.source.removeEventListener("mouseenter", record.onMouseEnter);
  }
  if (record.onMouseLeave) {
    record.source.removeEventListener("mouseleave", record.onMouseLeave);
  }
  record.host.remove();
  translationRecords.delete(id);
}

function withSuppressedTranslationObserver(fn: () => void): void {
  suppressTranslationObserver = true;
  try {
    fn();
  } finally {
    queueMicrotask(() => {
      suppressTranslationObserver = false;
    });
  }
}

function clearAllTranslations(): void {
  translationRunId += 1;
  if (translationTimer) {
    clearTimeout(translationTimer);
    translationTimer = null;
  }
  translationObserver?.disconnect();
  translationObserver = null;

  for (const id of Array.from(translationRecords.keys())) {
    removeTranslationRecord(id);
  }

  document.querySelectorAll(`[${TRANSLATION_SOURCE_ATTR}]`).forEach((node) => {
    const originalText = node.getAttribute(TRANSLATION_TEXT_ATTR);
    if (originalText !== null) {
      withSuppressedTranslationObserver(() => {
        node.textContent = originalText;
      });
    }
    node.removeAttribute(TRANSLATION_SOURCE_ATTR);
    node.removeAttribute(TRANSLATION_TEXT_ATTR);
  });
  lastPageTranslationSignature = "";
  pageTranslationInProgressSignature = "";
}

function getTranslationInsertPosition(node: HTMLElement): InsertPosition {
  const tagName = node.tagName.toLowerCase();
  if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "figcaption"].includes(tagName)) {
    return "afterend";
  }

  return "beforeend";
}

function positionTranslationOverlay(record: TranslationRecord): void {
  if (!record.source.isConnected) {
    return;
  }
  const rect = record.source.getBoundingClientRect();
  record.host.style.position = "absolute";
  record.host.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
  record.host.style.top = `${Math.max(8, rect.bottom + window.scrollY + 4)}px`;
  record.host.style.width = `${Math.max(160, rect.width)}px`;
  record.host.style.maxWidth = "min(720px, calc(100vw - 16px))";
  record.host.style.margin = "0";
  record.host.style.zIndex = "2147483646";
}

function ensureTranslationRecord(
  node: HTMLElement,
  id: string,
  position?: InsertPosition,
  overlay = false,
  attach = true
): TranslationRecord {
  const existing = translationRecords.get(id);
  if (existing) {
    existing.overlay = overlay;
    if (!attach) {
      existing.host.remove();
    } else if (overlay) {
      const overlayRoot = document.body ?? document.documentElement;
      if (existing.host.parentElement !== overlayRoot) {
        overlayRoot.appendChild(existing.host);
      }
      positionTranslationOverlay(existing);
    } else if (position) {
      node.insertAdjacentElement(position, existing.host);
    }
    return existing;
  }

  const host = document.createElement("div");
  host.setAttribute(TRANSLATION_HOST_ATTR, "true");
  host.style.display = "block";
  host.style.width = "100%";
  host.style.margin = "6px 0 10px";
  host.style.pointerEvents = "none";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = [
    ":host { all: initial; display: block; }",
    ".translation { display: block; line-height: 1.6; border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; word-break: break-word; box-sizing: border-box; }"
  ].join("\n");
  const body = document.createElement("div");
  body.className = "translation";
  shadow.appendChild(style);
  shadow.appendChild(body);

  const record: TranslationRecord = {
    id,
    source: node,
    host,
    body,
    sourceText: "",
    translatedText: "",
    overlay,
    displayMode: "below"
  };

  if (!attach) {
    // Replacement mode tracks source/translated text without adding layout nodes.
  } else if (overlay) {
    (document.body ?? document.documentElement).appendChild(host);
    positionTranslationOverlay(record);
  } else {
    node.insertAdjacentElement(position || getTranslationInsertPosition(node), host);
  }

  translationRecords.set(id, record);
  return record;
}

function markAutoTranslationRendered(record: TranslationRecord): void {
  record.lastRenderedSourceText = record.sourceText;
  record.lastRenderedTranslatedText = record.translatedText;
  record.lastRenderedDisplayMode = translationSettings.displayMode;
  record.lastRenderedStyleSignature = buildAutoTranslationRenderStyleSignature(translationSettings);
}

function shouldRerenderAutoTranslation(record: TranslationRecord, sourceText: string): boolean {
  if (!record.translatedText) {
    return false;
  }

  return (
    record.lastRenderedSourceText !== sourceText ||
    record.lastRenderedTranslatedText !== record.translatedText ||
    record.lastRenderedDisplayMode !== translationSettings.displayMode ||
    record.lastRenderedStyleSignature !== buildAutoTranslationRenderStyleSignature(translationSettings)
  );
}

function renderTranslationRecord(record: TranslationRecord): void {
  if (record.overlay) {
    positionTranslationOverlay(record);
  }
  record.body.textContent = record.translatedText;
  record.body.style.color = translationSettings.styleColor;
  record.body.style.background = translationSettings.styleBackground;
  record.body.style.fontSize = `${translationSettings.styleFontSize}px`;
  record.body.style.fontWeight = translationSettings.styleBold ? "700" : "400";
  record.body.style.fontStyle = translationSettings.styleItalic ? "italic" : "normal";
  record.body.style.display = "block";
  record.body.style.lineHeight = "1.6";

  if (!record.onMouseEnter) {
    record.onMouseEnter = () => {
      if ((record.displayMode ?? "below") === "hover") {
        record.host.style.display = "block";
      }
    };
    record.onMouseLeave = () => {
      if ((record.displayMode ?? "below") === "hover") {
        record.host.style.display = "none";
      }
    };
    record.source.addEventListener("mouseenter", record.onMouseEnter);
    record.source.addEventListener("mouseleave", record.onMouseLeave);
  }

  record.host.style.display = (record.displayMode ?? "below") === "hover" ? "none" : "block";
}

function createBilingualColumn(label: string, text: string, muted: boolean): HTMLDivElement {
  const column = document.createElement("div");
  column.style.minWidth = "0";

  if (label) {
    const labelEl = document.createElement("div");
    labelEl.textContent = label;
    labelEl.style.marginBottom = "4px";
    labelEl.style.fontSize = "12px";
    labelEl.style.fontWeight = "700";
    labelEl.style.opacity = "0.72";
    column.appendChild(labelEl);
  }

  const textEl = document.createElement("div");
  textEl.textContent = text;
  textEl.style.whiteSpace = "pre-wrap";
  textEl.style.wordBreak = "break-word";
  textEl.style.opacity = muted ? "0.78" : "1";

  column.appendChild(textEl);
  return column;
}

function renderBilingualTranslationRecord(
  record: TranslationRecord,
  options: {
    sourceText: string;
    translatedText: string;
    sourceLabel: string;
    targetLabel: string;
    layout: "stacked" | "side-by-side";
  }
): void {
  record.body.textContent = "";
  record.body.style.color = options.sourceText ? translationSettings.styleColor : "inherit";
  record.body.style.background = "transparent";
  record.body.style.fontSize = `${translationSettings.styleFontSize}px`;
  record.body.style.fontWeight = translationSettings.styleBold ? "700" : "400";
  record.body.style.fontStyle = translationSettings.styleItalic ? "italic" : "normal";
  record.body.style.display = "block";
  record.body.style.gap = "0";
  record.body.style.lineHeight = "1.6";
  record.body.style.gridTemplateColumns = "";

  if (options.sourceText) {
    record.body.appendChild(createBilingualColumn(options.sourceLabel, options.sourceText, true));
  }
  record.body.appendChild(createBilingualColumn(options.targetLabel, options.translatedText, false));

  if (!record.onMouseEnter) {
    record.onMouseEnter = () => {
      if ((record.displayMode ?? "below") === "hover") {
        record.host.style.display = "block";
      }
    };
    record.onMouseLeave = () => {
      if ((record.displayMode ?? "below") === "hover") {
        record.host.style.display = "none";
      }
    };
    record.source.addEventListener("mouseenter", record.onMouseEnter);
    record.source.addEventListener("mouseleave", record.onMouseLeave);
  }

  record.host.style.display = (record.displayMode ?? "below") === "hover" ? "none" : "block";
}

function renderAutoTranslationRecord(record: TranslationRecord): void {
  if (translationSettings.displayMode === "replace") {
    record.host.remove();
    withSuppressedTranslationObserver(() => {
      record.source.textContent = record.translatedText;
    });
    markAutoTranslationRendered(record);
    return;
  }

  renderBilingualTranslationRecord(record, {
    sourceText: "",
    translatedText: record.translatedText,
    sourceLabel: "",
    targetLabel: "",
    layout: "stacked"
  });
  const sourceColor = window.getComputedStyle?.(record.source).color;
  record.body.style.color = sourceColor && sourceColor !== "rgba(0, 0, 0, 0)" ? sourceColor : "inherit";
  markAutoTranslationRendered(record);
}

function resolvePageElement(selector: string, index: number): { element: HTMLElement } | { error: string } {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
  if (elements.length === 0) {
    return { error: `No elements found for selector: ${selector}` };
  }
  if (index >= elements.length) {
    return { error: `Index ${index} out of range (found ${elements.length})` };
  }
  return { element: elements[index] };
}

function applyTranslationDisplayMode(record: TranslationRecord, displayMode: "below" | "hover"): void {
  record.displayMode = displayMode;
  if (!record.onMouseEnter) {
    record.onMouseEnter = () => {
      if ((record.displayMode ?? "below") === "hover") {
        record.host.style.display = "block";
      }
    };
    record.onMouseLeave = () => {
      if ((record.displayMode ?? "below") === "hover") {
        record.host.style.display = "none";
      }
    };
    record.source.addEventListener("mouseenter", record.onMouseEnter);
    record.source.addEventListener("mouseleave", record.onMouseLeave);
  }

  record.host.style.display = displayMode === "hover" ? "none" : "block";
}

function createInsertedTextBlock(text: string): HTMLDivElement {
  const block = document.createElement("div");
  block.setAttribute(TRANSLATION_HOST_ATTR, "true");
  block.style.display = "block";
  block.style.margin = "6px 0 10px";
  block.style.padding = "8px 10px";
  block.style.borderRadius = "8px";
  block.style.lineHeight = "1.6";
  block.style.whiteSpace = "pre-wrap";
  block.style.wordBreak = "break-word";
  block.style.color = translationSettings.styleColor;
  block.style.background = translationSettings.styleBackground;
  block.style.fontSize = `${translationSettings.styleFontSize}px`;
  block.style.fontWeight = translationSettings.styleBold ? "700" : "400";
  block.style.fontStyle = translationSettings.styleItalic ? "italic" : "normal";
  block.textContent = text;
  return block;
}

function cleanTranslationOutput(text: string): string {
  let output = text.trim();
  output = output.replace(/^```(?:json|markdown|text|[a-z-]+)?\s*/i, "").replace(/\s*```$/i, "").trim();
  output = output.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();

  if (/(?:没有|未|没)(?:提供|给出|输入).{0,12}(?:需要|要)?翻译|请提供.{0,12}(?:需要|要)?翻译|no\s+(?:text|content|paragraph).{0,20}(?:provided|given)|(?:text|content|paragraph)\s+(?:was\s+)?not\s+(?:provided|given)/i.test(output)) {
    return "";
  }

  const reasoningPattern = /\b(?:The user wants me to translate|I (?:need|should|will) translate|Since the instruction|Given the context|Wait, let me|Actually,|This appears to be|This could be|the most appropriate translation)\b/i;
  if (reasoningPattern.test(output)) {
    const cjkMatches = output.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s，。！？、；：,.!?;:（）()《》“”"'‘’-]*$/gu);
    if (cjkMatches?.length) {
      output = cjkMatches[cjkMatches.length - 1].replace(/^[\s，。！？、；：,.!?;:（）()《》“”"'‘’-]+|[\s，。！？、；：,.!?;:（）()《》“”"'‘’-]+$/g, "").trim();
    } else {
      return "";
    }
  }

  const labelPattern = /^(?:翻译(?:结果|如下|为)?|译文|目标语言译文|translation|translated(?:\s+text)?|result|answer)\s*[:：\-—]\s*/i;
  for (let i = 0; i < 3; i += 1) {
    const next = output.replace(labelPattern, "").trim();
    if (next === output) break;
    output = next;
  }

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    const filtered = lines.filter((line) => !/^(?:以下是|这是|好的|当然|sure\b|here(?:'s| is)\b)/i.test(line));
    if (filtered.length > 0) {
      output = filtered.join("\n").trim();
    }
  }

  return output;
}

function finishSelectionTranslationPopup(popup: HTMLDivElement, text: string, rect: DOMRect | null, fallback?: { x: number; y: number }): void {
  const cleaned = cleanTranslationOutput(text);
  if (!cleaned) {
    detachSelectionTranslationPopup();
    lastSelectionTranslationKey = "";
    return;
  }
  popup.textContent = cleaned;
  positionSelectionTranslationPopup(popup, rect, fallback);
}

function getChromeRuntime(): typeof chrome.runtime | null {
  if (typeof chrome === "undefined" || !chrome.runtime) {
    return null;
  }
  return chrome.runtime;
}

function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Extension context invalidated/i.test(message);
}

async function requestTranslationsBatch(texts: string[]): Promise<string[]> {
  const runtime = getChromeRuntime();
  if (!runtime?.sendMessage) {
    throw new Error("扩展运行时不可用，请刷新页面后重试");
  }

  const response = await runtime.sendMessage({
    type: "TRANSLATE_SEGMENTS",
    payload: {
      segments: texts,
      targetLanguage: translationSettings.targetLanguage
    }
  }) as { ok?: boolean; data?: { translations?: string[] }; errors?: string[] };

  if (!response?.ok || !Array.isArray(response.data?.translations)) {
    const message = Array.isArray(response?.errors) ? response.errors.join(", ") : "Translation failed";
    throw new Error(message);
  }

  return response.data.translations.map(cleanTranslationOutput);
}

function requestTranslationStream(
  text: string,
  onDelta: (delta: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port | null = null;
    let accumulated = "";
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      try {
        port?.disconnect();
      } catch {
        // ignored
      }
      if (error) {
        reject(error);
      } else {
        resolve(cleanTranslationOutput(accumulated));
      }
    };

    const runtime = getChromeRuntime();
    if (!runtime?.connect) {
      reject(new Error("扩展运行时不可用，请刷新页面后重试"));
      return;
    }

    try {
      port = runtime.connect({ name: "TRANSLATE_SEGMENT_STREAM" });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    port.onMessage.addListener((message: { type?: string; delta?: string; text?: string; error?: string }) => {
      if (message.type === "delta" && typeof message.delta === "string") {
        accumulated += message.delta;
        onDelta(message.delta);
        return;
      }
      if (message.type === "done") {
        if (typeof message.text === "string") {
          accumulated = message.text;
        }
        finish();
        return;
      }
      if (message.type === "error") {
        finish(new Error(message.error || "Translation failed"));
      }
    });

    port.onDisconnect.addListener(() => {
      if (!settled) {
        const lastError = getChromeRuntime()?.lastError?.message;
        if (lastError) {
          finish(new Error(lastError));
        } else {
          finish();
        }
      }
    });

    port.postMessage({
      text,
      targetLanguage: translationSettings.targetLanguage
    });
  });
}

function removeSelectionTranslationPopup(): void {
  selectionTranslationRunId += 1;
  selectionTranslationPopup?.remove();
  selectionTranslationPopup = null;
}

function detachSelectionTranslationPopup(): void {
  selectionTranslationPopup?.remove();
  selectionTranslationPopup = null;
}

function stopSelectionTranslationSilently(): void {
  selectionTranslationCleanup?.();
  selectionTranslationCleanup = null;
  selectionTranslationPopup?.remove();
  selectionTranslationPopup = null;
  lastSelectionTranslationKey = "";
}

function positionSelectionTranslationPopup(popup: HTMLDivElement, rect: DOMRect | null, fallback?: { x: number; y: number }): void {
  const x = rect ? rect.left + window.scrollX : fallback?.x ?? 16;
  const y = rect ? rect.bottom + window.scrollY + 8 : fallback?.y ?? 16;
  popup.style.left = `${Math.max(8, x)}px`;
  popup.style.top = `${Math.max(8, y)}px`;
}

function withAlphaColor(color: string, alpha: number): string {
  const trimmed = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split("").map((char) => `${char}${char}`).join("")
      : hex[1];
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+[\d.]+)?\s*\)$/i.exec(trimmed);
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  }

  return `rgba(248, 250, 252, ${alpha})`;
}

function parseRgbColor(color: string): { r: number; g: number; b: number } | null {
  const trimmed = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split("").map((char) => `${char}${char}`).join("")
      : hex[1];
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16)
    };
  }

  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+[\d.]+)?\s*\)$/i.exec(trimmed);
  return rgb
    ? { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
    : null;
}

function readableTextColorForBackground(color: string): string {
  const rgb = parseRgbColor(color);
  if (!rgb) return translationSettings.styleColor || "#0f172a";
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance < 0.48 ? "#f8fafc" : "#0f172a";
}

function isTransparentColor(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  return !normalized ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)" ||
    normalized === "rgba(0,0,0,0)";
}

function resolveElementBackgroundColor(element: Element | null): string {
  let current: Element | null = element;
  while (current) {
    const background = window.getComputedStyle?.(current).backgroundColor || "";
    if (!isTransparentColor(background)) {
      return background;
    }
    current = current.parentElement;
  }

  const bodyBackground = document.body ? window.getComputedStyle?.(document.body).backgroundColor || "" : "";
  if (!isTransparentColor(bodyBackground)) {
    return bodyBackground;
  }

  const rootBackground = window.getComputedStyle?.(document.documentElement).backgroundColor || "";
  return isTransparentColor(rootBackground) ? "#f8fafc" : rootBackground;
}

function resolvePopupBaseBackground(rect: DOMRect | null, fallback?: { x: number; y: number }): string {
  const clientX = rect ? rect.left + rect.width / 2 : fallback ? fallback.x - window.scrollX : 16;
  const clientY = rect ? rect.top + rect.height / 2 : fallback ? fallback.y - window.scrollY : 16;
  const element = document.elementFromPoint?.(clientX, clientY) ?? null;
  return resolveElementBackgroundColor(element);
}

function createSelectionTranslationPopup(text: string, rect: DOMRect | null, fallback?: { x: number; y: number }): HTMLDivElement {
  detachSelectionTranslationPopup();

  const popup = document.createElement("div");
  popup.setAttribute(SELECTION_TRANSLATION_POPUP_ATTR, "true");
  popup.style.position = "absolute";
  popup.style.zIndex = "2147483647";
  popup.style.boxSizing = "border-box";
  popup.style.width = "max-content";
  popup.style.maxWidth = "min(420px, calc(100vw - 16px))";
  popup.style.minWidth = "0";
  popup.style.padding = "10px 12px";
  popup.style.borderRadius = "8px";
  const baseBackground = resolvePopupBaseBackground(rect, fallback);
  popup.style.border = "0";
  popup.style.boxShadow = "0 12px 32px rgba(15, 23, 42, .16)";
  popup.style.background = withAlphaColor(baseBackground, 0.42);
  popup.style.backdropFilter = "blur(18px) saturate(1.35)";
  popup.style.setProperty?.("-webkit-backdrop-filter", "blur(18px) saturate(1.35)");
  popup.style.color = readableTextColorForBackground(baseBackground);
  popup.style.fontSize = `${Math.max(12, translationSettings.styleFontSize)}px`;
  popup.style.fontWeight = translationSettings.styleBold ? "700" : "400";
  popup.style.fontStyle = translationSettings.styleItalic ? "italic" : "normal";
  popup.style.lineHeight = "1.55";
  popup.style.whiteSpace = "pre-wrap";
  popup.style.wordBreak = "break-word";
  popup.style.pointerEvents = "auto";
  popup.textContent = text;

  (document.body ?? document.documentElement).appendChild(popup);
  positionSelectionTranslationPopup(popup, rect, fallback);
  selectionTranslationPopup = popup;
  return popup;
}

function getCurrentSelectionText(): { text: string; rect: DOMRect | null } {
  const selection = window.getSelection?.();
  const text = normalizeText(selection?.toString() || "");
  if (!selection || selection.rangeCount === 0 || !text) {
    return { text: "", rect: null };
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  return { text, rect: rect.width || rect.height ? rect : null };
}

function shouldTranslateSelectionText(text: string): boolean {
  return text.length > 0 && text.length <= 800;
}

async function translateSelectionText(text: string, rect: DOMRect | null, fallback?: { x: number; y: number }): Promise<void> {
  if (!translationSettings.selectionEnabled || !shouldTranslateSelectionText(text)) {
    return;
  }

  const key = `${translationSettings.targetLanguage}::${text}`;
  if (key === lastSelectionTranslationKey && selectionTranslationPopup) {
    return;
  }
  lastSelectionTranslationKey = key;

  const runId = ++selectionTranslationRunId;
  const popup = createSelectionTranslationPopup("翻译中...", rect, fallback);

  try {
    let streamedText = "";
    const finalText = await requestTranslationStream(text, (delta) => {
      if (runId !== selectionTranslationRunId || !translationSettings.selectionEnabled) {
        return;
      }
      streamedText += delta;
      popup.textContent = cleanTranslationOutput(streamedText) || "翻译中...";
      positionSelectionTranslationPopup(popup, rect, fallback);
    });

    if (runId !== selectionTranslationRunId || !translationSettings.selectionEnabled) {
      return;
    }
    finishSelectionTranslationPopup(popup, finalText || streamedText || "", rect, fallback);
  } catch (streamError) {
    if (isExtensionContextInvalidated(streamError)) {
      stopSelectionTranslationSilently();
      return;
    }

    try {
      const [fallbackTranslation] = await requestTranslationsBatch([text]);
      if (runId === selectionTranslationRunId && translationSettings.selectionEnabled) {
        finishSelectionTranslationPopup(popup, fallbackTranslation, rect, fallback);
      }
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        stopSelectionTranslationSilently();
        return;
      }
      if (runId === selectionTranslationRunId) {
        popup.textContent = `翻译失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }
}

function enableSelectionTranslation(): void {
  if (selectionTranslationCleanup || !document.body) {
    return;
  }

  const translateCurrentSelection = (event?: MouseEvent): void => {
    window.setTimeout(() => {
      const { text, rect } = getCurrentSelectionText();
      const fallback = event ? { x: event.pageX + 8, y: event.pageY + 8 } : undefined;
      void translateSelectionText(text, rect, fallback);
    }, 0);
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if ((event.target as Element | null)?.closest?.(`[${SELECTION_TRANSLATION_POPUP_ATTR}]`)) {
      return;
    }
    translateCurrentSelection(event);
  };

  const onMouseUp = (event: MouseEvent): void => {
    if ((event.target as Element | null)?.closest?.(`[${SELECTION_TRANSLATION_POPUP_ATTR}]`)) {
      return;
    }
    translateCurrentSelection(event);
  };

  const onMouseDown = (event: MouseEvent): void => {
    if ((event.target as Element | null)?.closest?.(`[${SELECTION_TRANSLATION_POPUP_ATTR}]`)) {
      return;
    }
    removeSelectionTranslationPopup();
    lastSelectionTranslationKey = "";
  };

  document.addEventListener("dblclick", onDoubleClick, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("mousedown", onMouseDown, true);

  selectionTranslationCleanup = () => {
    document.removeEventListener("dblclick", onDoubleClick, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    document.removeEventListener("mousedown", onMouseDown, true);
    removeSelectionTranslationPopup();
  };
}

function syncSelectionTranslation(): void {
  if (!translationSettings.selectionEnabled) {
    selectionTranslationCleanup?.();
    selectionTranslationCleanup = null;
    return;
  }

  if (!document.body) {
    document.addEventListener("DOMContentLoaded", () => {
      if (translationSettings.selectionEnabled) {
        enableSelectionTranslation();
      }
    }, { once: true });
    return;
  }

  enableSelectionTranslation();
}

async function translateParagraphIntoRecord(
  item: { id: string; node: HTMLElement; text: string },
  runId: number
): Promise<void> {
  const isReplacementMode = translationSettings.displayMode === "replace";
  const record = ensureTranslationRecord(item.node, item.id, undefined, false, !isReplacementMode);
  record.source = item.node;
  record.sourceText = item.text;
  record.translatedText = "翻译中...";
  if (!item.node.hasAttribute(TRANSLATION_TEXT_ATTR)) {
    item.node.setAttribute(TRANSLATION_TEXT_ATTR, item.text);
  }
  renderAutoTranslationRecord(record);

  try {
    let streamedText = "";
    const finalText = await requestTranslationStream(item.text, (delta) => {
      if (runId !== translationRunId || !translationSettings.enabled) {
        return;
      }
      streamedText += delta;
      record.translatedText = cleanTranslationOutput(streamedText);
      renderAutoTranslationRecord(record);
    });

    if (runId !== translationRunId || !translationSettings.enabled) {
      return;
    }

    record.translatedText = cleanTranslationOutput(finalText || streamedText || "");
    if (!record.translatedText) {
      removeTranslationRecord(item.id);
      return;
    }
    renderAutoTranslationRecord(record);
    item.node.setAttribute(TRANSLATION_TEXT_ATTR, item.text);
  } catch {
    const [fallback] = await requestTranslationsBatch([item.text]);
    if (runId !== translationRunId || !translationSettings.enabled) {
      return;
    }
    record.translatedText = cleanTranslationOutput(fallback || "");
    if (!record.translatedText) {
      removeTranslationRecord(item.id);
      return;
    }
    renderAutoTranslationRecord(record);
    item.node.setAttribute(TRANSLATION_TEXT_ATTR, item.text);
  }
}

async function runTranslationScan(): Promise<void> {
  if (!translationSettings.enabled) {
    return;
  }

  const runId = ++translationRunId;
  const runSignature = pageTranslationInProgressSignature;
  const nodes = collectTranslatableElements();
  const activeIds = new Set<string>();
  const pending: Array<{ id: string; node: HTMLElement; text: string }> = [];

  for (const node of nodes) {
    const id = ensureTranslationId(node);
    activeIds.add(id);

    const existingSourceText = node.getAttribute(TRANSLATION_TEXT_ATTR);
    if (existingSourceText && translationSettings.displayMode === "bilingual" && node.textContent !== existingSourceText) {
      withSuppressedTranslationObserver(() => {
        node.textContent = existingSourceText;
      });
    }

    const text = existingSourceText || normalizeText(node.innerText || node.textContent || "");
    if (!text) {
      continue;
    }

    const record = ensureTranslationRecord(
      node,
      id,
      undefined,
      false,
      translationSettings.displayMode === "bilingual"
    );
    if (record.sourceText === text && record.translatedText) {
      if (shouldRerenderAutoTranslation(record, text)) {
        renderAutoTranslationRecord(record);
      }
      continue;
    }

    record.source = node;
    record.sourceText = text;
    pending.push({ id, node, text });
  }

  for (const [id, record] of translationRecords.entries()) {
    if (!activeIds.has(id) || !record.source.isConnected) {
      removeTranslationRecord(id);
    }
  }

  for (let start = 0; start < pending.length; start += translationSettings.batchSize) {
    if (runId !== translationRunId || !translationSettings.enabled) {
      return;
    }

    const batch = pending.slice(start, start + translationSettings.batchSize);
    await Promise.all(batch.map((item) => translateParagraphIntoRecord(item, runId)));
    if (runId !== translationRunId || !translationSettings.enabled) {
      return;
    }
  }

  if (runSignature && runId === translationRunId && translationSettings.enabled) {
    lastPageTranslationSignature = runSignature;
    pageTranslationInProgressSignature = "";
  }
}

function scheduleTranslationScan(): void {
  if (!translationSettings.enabled) {
    return;
  }

  if (translationTimer) {
    clearTimeout(translationTimer);
  }

  translationTimer = setTimeout(() => {
    translationTimer = null;
    void runTranslationScan().catch(() => {
      // ignored
    });
  }, translationSettings.debounceMs);
}

function ensureTranslationObserver(): void {
  if (translationObserver || !document.body) {
    return;
  }

  translationObserver = new MutationObserver((mutations) => {
    const hasRelevantChange = mutations.some((mutation) => {
      if (suppressTranslationObserver) {
        return false;
      }

      if (mutation.type === "characterData") {
        return true;
      }

      return Array.from(mutation.addedNodes).some((node) => {
        return node instanceof HTMLElement && !isTranslationHost(node);
      });
    });

    if (hasRelevantChange) {
      scheduleTranslationScan();
    }
  });

  translationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function applyTranslationSettings(next: TranslationSettings): void {
  translationSettings = next;
  syncSelectionTranslation();

  if (!translationSettings.enabled) {
    clearAllTranslations();
    return;
  }

  if (!document.body) {
    document.addEventListener("DOMContentLoaded", () => {
      if (translationSettings.enabled) {
        ensureTranslationObserver();
        scheduleTranslationScan();
      }
    }, { once: true });
    return;
  }

  ensureTranslationObserver();
  scheduleTranslationScan();
}

function buildPageTranslationSignature(settings: TranslationSettings): string {
  const texts = collectTranslatableElements()
    .map((node) => normalizeText(node.getAttribute(TRANSLATION_TEXT_ATTR) || node.innerText || node.textContent || ""))
    .filter(Boolean)
    .slice(0, 200);

  return [
    location.href.split("#")[0],
    settings.targetLanguage,
    settings.displayMode,
    settings.styleColor,
    settings.styleBackground,
    settings.styleFontSize,
    settings.styleBold ? "bold" : "normal",
    settings.styleItalic ? "italic" : "regular",
    texts.join("\n").slice(0, 20000)
  ].join("\n---\n");
}

function isPageAlreadyTranslated(settings: TranslationSettings): boolean {
  const signature = buildPageTranslationSignature(settings);
  if (!signature || translationRecords.size === 0) {
    return false;
  }

  return signature === lastPageTranslationSignature || signature === pageTranslationInProgressSignature;
}

function translateCurrentPageOnce(next: TranslationSettings): { skipped: boolean; count: number } {
  const settings = {
    ...next,
    enabled: true
  };
  if (isPageAlreadyTranslated(settings)) {
    return { skipped: true, count: translationRecords.size };
  }

  pageTranslationInProgressSignature = buildPageTranslationSignature(settings);
  applyTranslationSettings(settings);
  return { skipped: false, count: translationRecords.size };
}

// ── Agent Page Tool Handlers ──

function agentGetPageInfo(): { url: string; title: string; description: string } {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  return {
    url: location.href,
    title: document.title || "Untitled",
    description: meta?.content ?? ""
  };
}

function agentReadPageContent(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "body";
  const maxLength = typeof args.maxLength === "number" ? args.maxLength : 8000;
  const el = document.querySelector(selector);
  if (!el) {
    return `No element found for selector: ${selector}`;
  }
  const text = (el as HTMLElement).innerText || el.textContent || "";
  return text.slice(0, maxLength);
}

function agentTranslateCurrentPage(): string {
  const result = translateCurrentPageOnce(translationSettings);
  return result.skipped
    ? "Current page has already been translated with the same settings."
    : "Started translating the current page.";
}

function agentQuerySelector(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "*";
  const limit = typeof args.limit === "number" ? args.limit : 20;
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, limit);

  if (elements.length === 0) {
    return `No elements found for selector: ${selector}`;
  }

  const results = elements.map((el, i) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = el.className && typeof el.className === "string"
      ? `.${el.className.trim().split(/\s+/).join(".")}`
      : "";
    const text = (el.innerText || "").slice(0, 100).replace(/\n/g, " ").trim();
    const type = el.getAttribute("type") ?? "";
    const href = el.getAttribute("href") ?? "";
    const value = (el as HTMLInputElement).value ?? "";

    let info = `[${i}] <${tag}${id}${cls}>`;
    if (type) info += ` type="${type}"`;
    if (href) info += ` href="${href.slice(0, 80)}"`;
    if (value) info += ` value="${value.slice(0, 50)}"`;
    if (text) info += ` "${text}"`;
    return info;
  });

  return `Found ${elements.length} element(s):\n${results.join("\n")}`;
}

function agentWriteTranslationToPage(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "";
  const text = typeof args.text === "string" ? args.text : "";
  const index = typeof args.index === "number" ? args.index : 0;
  const displayMode = args.displayMode === "hover" ? "hover" : "below";
  const position = typeof args.position === "string" ? (args.position as InsertPosition) : undefined;

  if (!selector) return "Error: selector is required";
  if (!text.trim()) return "Error: text is required";

  const resolved = resolvePageElement(selector, index);
  if ("error" in resolved) return resolved.error;

  const id = ensureTranslationId(resolved.element);
  const record = ensureTranslationRecord(resolved.element, id, position);
  record.source = resolved.element;
  record.sourceText = normalizeText(resolved.element.innerText || resolved.element.textContent || "");
  record.translatedText = text.trim();
  renderTranslationRecord(record);
  applyTranslationDisplayMode(record, displayMode);

  return `Wrote translation near ${selector}[${index}] using ${displayMode} mode`;
}

function agentRemoveTranslationFromPage(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "";
  const index = typeof args.index === "number" ? args.index : 0;

  if (!selector) {
    const count = translationRecords.size;
    clearAllTranslations();
    return `Removed ${count} translation block(s) from page`;
  }

  const resolved = resolvePageElement(selector, index);
  if ("error" in resolved) return resolved.error;

  const id = resolved.element.getAttribute(TRANSLATION_SOURCE_ATTR);
  if (!id) {
    return `No translation block found for ${selector}[${index}]`;
  }

  removeTranslationRecord(id);
  resolved.element.removeAttribute(TRANSLATION_SOURCE_ATTR);
  resolved.element.removeAttribute(TRANSLATION_TEXT_ATTR);
  return `Removed translation for ${selector}[${index}]`;
}

function agentUpdateTranslationOnPage(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "";
  const text = typeof args.text === "string" ? args.text : "";
  const index = typeof args.index === "number" ? args.index : 0;
  const displayMode = args.displayMode === "hover" ? "hover" : "below";
  const position = typeof args.position === "string" ? (args.position as InsertPosition) : undefined;

  if (!selector) return "Error: selector is required";
  if (!text.trim()) return "Error: text is required";

  const resolved = resolvePageElement(selector, index);
  if ("error" in resolved) return resolved.error;

  const existingId = resolved.element.getAttribute(TRANSLATION_SOURCE_ATTR);
  const id = existingId || ensureTranslationId(resolved.element);
  const record = ensureTranslationRecord(resolved.element, id, position);

  record.source = resolved.element;
  record.sourceText = normalizeText(resolved.element.innerText || resolved.element.textContent || "");
  record.translatedText = text.trim();
  renderTranslationRecord(record);
  applyTranslationDisplayMode(record, displayMode);

  return existingId
    ? `Updated translation for ${selector}[${index}] in place`
    : `Created translation for ${selector}[${index}] using ${displayMode} mode`;
}

function agentWriteBilingualTranslationToPage(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "";
  const translatedText = typeof args.translatedText === "string" ? args.translatedText : "";
  const index = typeof args.index === "number" ? args.index : 0;
  const displayMode = args.displayMode === "hover" ? "hover" : "below";
  const position = typeof args.position === "string" ? (args.position as InsertPosition) : undefined;
  const layout = args.layout === "side-by-side" ? "side-by-side" : "stacked";
  const sourceLabel = typeof args.sourceLabel === "string" && args.sourceLabel.trim() ? args.sourceLabel.trim() : "原文";
  const targetLabel = typeof args.targetLabel === "string" && args.targetLabel.trim() ? args.targetLabel.trim() : "译文";

  if (!selector) return "Error: selector is required";
  if (!translatedText.trim()) return "Error: translatedText is required";

  const resolved = resolvePageElement(selector, index);
  if ("error" in resolved) return resolved.error;

  const sourceText = typeof args.sourceText === "string" && args.sourceText.trim()
    ? args.sourceText.trim()
    : normalizeText(resolved.element.innerText || resolved.element.textContent || "");
  if (!sourceText) return "Error: sourceText is empty";

  const id = ensureTranslationId(resolved.element);
  const record = ensureTranslationRecord(resolved.element, id, position);
  record.source = resolved.element;
  record.sourceText = sourceText;
  record.translatedText = translatedText.trim();
  renderBilingualTranslationRecord(record, {
    sourceText,
    translatedText: translatedText.trim(),
    sourceLabel,
    targetLabel,
    layout
  });
  applyTranslationDisplayMode(record, displayMode);

  return `Wrote bilingual translation near ${selector}[${index}] using ${layout} layout and ${displayMode} mode`;
}

function agentUpdateBilingualTranslationOnPage(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "";
  const translatedText = typeof args.translatedText === "string" ? args.translatedText : "";
  const index = typeof args.index === "number" ? args.index : 0;
  const displayMode = args.displayMode === "hover" ? "hover" : "below";
  const position = typeof args.position === "string" ? (args.position as InsertPosition) : undefined;
  const layout = args.layout === "side-by-side" ? "side-by-side" : "stacked";
  const sourceLabel = typeof args.sourceLabel === "string" && args.sourceLabel.trim() ? args.sourceLabel.trim() : "原文";
  const targetLabel = typeof args.targetLabel === "string" && args.targetLabel.trim() ? args.targetLabel.trim() : "译文";

  if (!selector) return "Error: selector is required";
  if (!translatedText.trim()) return "Error: translatedText is required";

  const resolved = resolvePageElement(selector, index);
  if ("error" in resolved) return resolved.error;

  const sourceText = typeof args.sourceText === "string" && args.sourceText.trim()
    ? args.sourceText.trim()
    : normalizeText(resolved.element.innerText || resolved.element.textContent || "");
  if (!sourceText) return "Error: sourceText is empty";

  const existingId = resolved.element.getAttribute(TRANSLATION_SOURCE_ATTR);
  const id = existingId || ensureTranslationId(resolved.element);
  const record = ensureTranslationRecord(resolved.element, id, position);
  record.source = resolved.element;
  record.sourceText = sourceText;
  record.translatedText = translatedText.trim();
  renderBilingualTranslationRecord(record, {
    sourceText,
    translatedText: translatedText.trim(),
    sourceLabel,
    targetLabel,
    layout
  });
  applyTranslationDisplayMode(record, displayMode);

  return existingId
    ? `Updated bilingual translation for ${selector}[${index}] in place`
    : `Created bilingual translation for ${selector}[${index}] using ${layout} layout and ${displayMode} mode`;
}

function agentInsertTextBlock(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "";
  const text = typeof args.text === "string" ? args.text : "";
  const index = typeof args.index === "number" ? args.index : 0;
  const position = typeof args.position === "string" ? args.position : "afterend";

  if (!selector) return "Error: selector is required";
  if (!text.trim()) return "Error: text is required";
  if (!["beforebegin", "afterbegin", "beforeend", "afterend"].includes(position)) {
    return `Error: unsupported position ${position}`;
  }

  const resolved = resolvePageElement(selector, index);
  if ("error" in resolved) return resolved.error;

  const block = createInsertedTextBlock(text.trim());
  resolved.element.insertAdjacentElement(position as InsertPosition, block);
  return `Inserted text block ${position} of ${selector}[${index}]`;
}

function getCanvasButtonMask(button: number): number {
  switch (button) {
    case 1:
      return 4;
    case 2:
      return 2;
    default:
      return 1;
  }
}

function parseCanvasCellReference(cell: string): { row: number; col: number } | null {
  const normalized = cell.trim().toUpperCase();
  const match = /^([A-Z]+)(\d+)$/.exec(normalized);
  if (!match) return null;

  const [, letters, rowDigits] = match;
  let col = 0;
  for (const char of letters) {
    col = (col * 26) + (char.charCodeAt(0) - 64);
  }

  return {
    row: Number.parseInt(rowDigits, 10) - 1,
    col: col - 1
  };
}

function getCanvasElements(selector: string): HTMLCanvasElement[] {
  return Array.from(document.querySelectorAll(selector)).filter((element): element is HTMLCanvasElement => {
    if (typeof HTMLCanvasElement === "function") {
      return element instanceof HTMLCanvasElement;
    }
    return element.tagName.toLowerCase() === "canvas";
  });
}

function resolveCanvasTarget(
  selector: string,
  index: number
): { canvas: HTMLCanvasElement; rect: DOMRect | ReturnType<HTMLCanvasElement["getBoundingClientRect"]> } | { error: string } {
  const canvases = getCanvasElements(selector);
  if (canvases.length === 0) {
    return { error: `No canvas elements found for selector: ${selector}` };
  }
  if (index >= canvases.length) {
    return { error: `Index ${index} out of range (found ${canvases.length})` };
  }

  const canvas = canvases[index];
  return { canvas, rect: canvas.getBoundingClientRect() };
}

function resolveCanvasCoordinates(
  canvas: HTMLCanvasElement,
  rect: { width: number; height: number },
  x: number,
  y: number,
  coordinateMode: "css" | "ratio"
): { cssX: number; cssY: number; bufferX: number; bufferY: number } | { error: string } {
  const cssX = coordinateMode === "ratio" ? rect.width * x : x;
  const cssY = coordinateMode === "ratio" ? rect.height * y : y;

  if (cssX < 0 || cssY < 0 || cssX > rect.width || cssY > rect.height) {
    return {
      error: `Point (${cssX.toFixed(1)}, ${cssY.toFixed(1)}) is outside canvas bounds ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`
    };
  }

  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  const maxBufferX = Math.max(0, canvas.width - 1);
  const maxBufferY = Math.max(0, canvas.height - 1);
  const bufferX = Math.min(maxBufferX, Math.max(0, Math.floor(cssX * scaleX)));
  const bufferY = Math.min(maxBufferY, Math.max(0, Math.floor(cssY * scaleY)));

  return { cssX, cssY, bufferX, bufferY };
}

function toHexChannel(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function dispatchCanvasMouseSequence(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  button: number
): void {
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + x;
  const clientY = rect.top + y;
  const commonInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    button,
    buttons: getCanvasButtonMask(button),
    detail: 1
  };

  canvas.focus?.();

  if (typeof PointerEvent === "function") {
    canvas.dispatchEvent(new PointerEvent("pointermove", commonInit));
    canvas.dispatchEvent(new PointerEvent("pointerdown", commonInit));
  }
  canvas.dispatchEvent(new MouseEvent("mousemove", commonInit));
  canvas.dispatchEvent(new MouseEvent("mousedown", commonInit));

  const releaseInit: MouseEventInit = {
    ...commonInit,
    buttons: 0
  };

  if (typeof PointerEvent === "function") {
    canvas.dispatchEvent(new PointerEvent("pointerup", releaseInit));
  }
  canvas.dispatchEvent(new MouseEvent("mouseup", releaseInit));
  canvas.dispatchEvent(new MouseEvent("click", releaseInit));
}

function agentQueryCanvas(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "canvas";
  const limit = typeof args.limit === "number" ? args.limit : 10;
  const canvases = getCanvasElements(selector).slice(0, limit);

  if (canvases.length === 0) {
    return `No canvas elements found for selector: ${selector}`;
  }

  const lines = canvases.map((canvas, index) => {
    const rect = canvas.getBoundingClientRect();
    const id = canvas.id ? `#${canvas.id}` : "";
    const cls = canvas.className && typeof canvas.className === "string"
      ? `.${canvas.className.trim().split(/\s+/).join(".")}`
      : "";
    return `[${index}] <canvas${id}${cls}> css=${Math.round(rect.width)}x${Math.round(rect.height)} px buffer=${canvas.width}x${canvas.height} at (${Math.round(rect.left)}, ${Math.round(rect.top)})`;
  });

  return `Found ${canvases.length} canvas element(s):\n${lines.join("\n")}`;
}

function agentInspectCanvasPixel(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "canvas";
  const index = typeof args.index === "number" ? args.index : 0;
  const x = typeof args.x === "number" ? args.x : NaN;
  const y = typeof args.y === "number" ? args.y : NaN;
  const coordinateMode = args.coordinateMode === "ratio" ? "ratio" : "css";

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return "Error: x and y are required";
  }

  const target = resolveCanvasTarget(selector, index);
  if ("error" in target) return target.error;

  const { canvas, rect } = target;
  const point = resolveCanvasCoordinates(canvas, rect, x, y, coordinateMode);
  if ("error" in point) return point.error;

  const context = canvas.getContext("2d");
  if (!context) {
    return "Error: canvas does not expose a 2d context";
  }

  try {
    const imageData = context.getImageData(point.bufferX, point.bufferY, 1, 1).data;
    const [r, g, b, a] = imageData;
    return JSON.stringify({
      selector,
      index,
      coordinateMode,
      cssPoint: {
        x: Number(point.cssX.toFixed(2)),
        y: Number(point.cssY.toFixed(2))
      },
      canvasPixel: {
        x: point.bufferX,
        y: point.bufferY
      },
      rgba: { r, g, b, a },
      hex: `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}${toHexChannel(a)}`
    });
  } catch (error) {
    return `Inspect canvas pixel failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function agentClickCanvas(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "canvas";
  const index = typeof args.index === "number" ? args.index : 0;
  const x = typeof args.x === "number" ? args.x : NaN;
  const y = typeof args.y === "number" ? args.y : NaN;
  const coordinateMode = args.coordinateMode === "ratio" ? "ratio" : "css";
  const button = typeof args.button === "number" ? args.button : 0;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return "Error: x and y are required";
  }

  const target = resolveCanvasTarget(selector, index);
  if ("error" in target) return target.error;

  const { canvas, rect } = target;
  const point = resolveCanvasCoordinates(canvas, rect, x, y, coordinateMode);
  if ("error" in point) return point.error;

  dispatchCanvasMouseSequence(canvas, point.cssX, point.cssY, button);
  return `Clicked canvas ${selector}[${index}] at (${point.cssX.toFixed(1)}, ${point.cssY.toFixed(1)}) using ${coordinateMode} coordinates`;
}

function agentClickCanvasCell(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "canvas";
  const index = typeof args.index === "number" ? args.index : 0;
  const rows = typeof args.rows === "number" && args.rows > 0 ? args.rows : 8;
  const cols = typeof args.cols === "number" && args.cols > 0 ? args.cols : 8;
  const origin = args.origin === "top-left" ? "top-left" : "bottom-left";
  const button = typeof args.button === "number" ? args.button : 0;
  const paddingTop = typeof args.paddingTop === "number" ? args.paddingTop : 0;
  const paddingRight = typeof args.paddingRight === "number" ? args.paddingRight : 0;
  const paddingBottom = typeof args.paddingBottom === "number" ? args.paddingBottom : 0;
  const paddingLeft = typeof args.paddingLeft === "number" ? args.paddingLeft : 0;

  const fromCell = typeof args.cell === "string" ? parseCanvasCellReference(args.cell) : null;
  const inputRow = fromCell?.row ?? (typeof args.row === "number" ? args.row : NaN);
  const col = fromCell?.col ?? (typeof args.col === "number" ? args.col : NaN);
  if (!Number.isInteger(inputRow) || !Number.isInteger(col)) {
    return "Error: provide row/col or a cell like A1";
  }
  if (inputRow < 0 || col < 0) {
    return "Error: row and col must be >= 0";
  }

  const displayRow = inputRow;
  const normalizedRow = origin === "bottom-left" ? (rows - 1 - inputRow) : inputRow;
  if (normalizedRow < 0 || normalizedRow >= rows || col >= cols) {
    return `Grid position out of range: row=${displayRow}, col=${col}, grid=${rows}x${cols}`;
  }

  const canvases = getCanvasElements(selector);
  if (canvases.length === 0) return `No canvas elements found for selector: ${selector}`;
  if (index >= canvases.length) return `Index ${index} out of range (found ${canvases.length})`;

  const canvas = canvases[index];
  const rect = canvas.getBoundingClientRect();
  const usableWidth = rect.width - paddingLeft - paddingRight;
  const usableHeight = rect.height - paddingTop - paddingBottom;
  if (usableWidth <= 0 || usableHeight <= 0) {
    return "Error: canvas padding leaves no usable area";
  }

  const cellWidth = usableWidth / cols;
  const cellHeight = usableHeight / rows;
  const clickX = paddingLeft + ((col + 0.5) * cellWidth);
  const clickY = paddingTop + ((normalizedRow + 0.5) * cellHeight);

  dispatchCanvasMouseSequence(canvas, clickX, clickY, button);
  return `Clicked canvas cell row=${displayRow}, col=${col} on ${selector}[${index}] at (${clickX.toFixed(1)}, ${clickY.toFixed(1)})`;
}

function agentClickElement(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "";
  const index = typeof args.index === "number" ? args.index : 0;
  if (!selector) return "Error: selector is required";

  const elements = document.querySelectorAll<HTMLElement>(selector);
  if (elements.length === 0) return `No elements found for selector: ${selector}`;
  if (index >= elements.length) return `Index ${index} out of range (found ${elements.length})`;

  const el = elements[index];
  el.click();
  const tag = el.tagName.toLowerCase();
  const text = (el.innerText || "").slice(0, 50).trim();
  return `Clicked <${tag}> ${text ? `"${text}"` : `at index ${index}`}`;
}

function agentTypeText(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "";
  const text = typeof args.text === "string" ? args.text : "";
  const index = typeof args.index === "number" ? args.index : 0;
  const clear = args.clear !== false;
  if (!selector) return "Error: selector is required";
  if (!text) return "Error: text is required";

  const elements = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (elements.length === 0) return `No elements found for selector: ${selector}`;
  if (index >= elements.length) return `Index ${index} out of range (found ${elements.length})`;

  const el = elements[index];
  el.focus();
  if (clear) {
    el.value = "";
  }
  el.value += text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return `Typed "${text.slice(0, 50)}" into <${el.tagName.toLowerCase()}>`;
}

function agentSelectOption(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "select";
  const value = typeof args.value === "string" ? args.value : undefined;
  const label = typeof args.label === "string" ? args.label : undefined;
  const index = typeof args.index === "number" ? args.index : 0;

  const elements = document.querySelectorAll<HTMLSelectElement>(selector);
  if (elements.length === 0) return `No select elements found for: ${selector}`;
  if (index >= elements.length) return `Index ${index} out of range`;

  const select = elements[index];
  const options = Array.from(select.options);

  let match: HTMLOptionElement | undefined;
  if (value !== undefined) {
    match = options.find((o) => o.value === value);
  } else if (label !== undefined) {
    match = options.find((o) => o.textContent?.trim() === label);
  }

  if (!match) return `No matching option found (value=${value}, label=${label})`;
  select.value = match.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return `Selected "${match.textContent?.trim()}" (value="${match.value}")`;
}

function agentScrollPage(args: Record<string, unknown>): string {
  const direction = typeof args.direction === "string" ? args.direction : "down";
  const pixels = typeof args.pixels === "number" ? args.pixels : 500;
  const selector = typeof args.selector === "string" ? args.selector : undefined;

  if (selector) {
    const el = document.querySelector(selector);
    if (!el) return `No element found for selector: ${selector}`;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    return `Scrolled to element: ${selector}`;
  }

  switch (direction) {
    case "up":
      window.scrollBy(0, -pixels);
      return `Scrolled up ${pixels}px`;
    case "down":
      window.scrollBy(0, pixels);
      return `Scrolled down ${pixels}px`;
    case "top":
      window.scrollTo(0, 0);
      return "Scrolled to top";
    case "bottom":
      window.scrollTo(0, document.body.scrollHeight);
      return "Scrolled to bottom";
    default:
      return `Unknown direction: ${direction}`;
  }
}

function agentExecuteScript(args: Record<string, unknown>): string {
  const code = typeof args.code === "string" ? args.code : "";
  if (!code) return "Error: code is required";

  try {
    const fn = new Function(code);
    const result = fn();
    if (result === undefined) return "Script executed (no return value)";
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch (error) {
    return `Script error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function agentInspectVisibilityDetection(args: Record<string, unknown>): string {
  const maxScripts = typeof args.maxScripts === "number" ? Math.max(1, args.maxScripts) : 80;
  const maxSnippetLength = typeof args.maxSnippetLength === "number"
    ? Math.max(80, args.maxSnippetLength)
    : 220;
  const keywords = [
    "visibilitychange",
    "webkitvisibilitychange",
    "mozvisibilitychange",
    "msvisibilitychange",
    "visibilityState",
    "document.hidden",
    "hidden",
    "blur",
    "focus",
    "pagehide",
    "freeze",
    "beforeunload",
    "切屏",
    "切换屏幕"
  ];

  const bodyText = typeof document.body?.innerText === "string"
    ? document.body.innerText
    : (document.body?.textContent ?? "");

  const findSnippet = (text: string, keyword: string): string => {
    const index = text.indexOf(keyword);
    if (index < 0) return "";
    const half = Math.floor(maxSnippetLength / 2);
    return text
      .slice(Math.max(0, index - half), index + keyword.length + half)
      .replace(/\s+/g, " ")
      .trim();
  };

  const propertyDescriptor = (target: object, key: "visibilityState" | "hidden") => {
    let proto: object | null = Object.getPrototypeOf(target);
    while (proto) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (descriptor) {
        return {
          owner: proto.constructor?.name || "Object",
          configurable: descriptor.configurable,
          enumerable: descriptor.enumerable,
          hasGetter: typeof descriptor.get === "function",
          getterPreview: String(descriptor.get ?? "").slice(0, 180)
        };
      }
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  };

  const functionPreview = (value: unknown): string | null => {
    return typeof value === "function" ? String(value).slice(0, 240) : null;
  };

  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script")).slice(0, maxScripts);
  const scriptSignals = scripts
    .map((script, index) => {
      const src = script.src || script.getAttribute("src") || "";
      const inlineText = src ? "" : (script.textContent || "");
      const haystack = `${src}\n${inlineText}`;
      const matches = keywords.filter((keyword) => haystack.includes(keyword));
      if (matches.length === 0) return null;
      return {
        index,
        src,
        inlineLength: inlineText.length,
        matches,
        snippet: inlineText ? findSnippet(inlineText, matches[0]) : ""
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  let evalAllowed = false;
  let evalError = "";
  try {
    // This is a diagnostic probe only; it does not run page logic.
    evalAllowed = new Function("return true")() === true;
  } catch (error) {
    evalError = error instanceof Error ? error.message : String(error);
  }

  const textSignals = keywords
    .map((keyword) => ({ keyword, snippet: findSnippet(bodyText, keyword) }))
    .filter((item) => item.snippet);

  const report = {
    url: location.href,
    title: document.title || "",
    visibility: {
      state: document.visibilityState,
      hidden: document.hidden,
      visibilityStateDescriptor: propertyDescriptor(document, "visibilityState"),
      hiddenDescriptor: propertyDescriptor(document, "hidden")
    },
    handlerProperties: {
      documentOnvisibilitychange: functionPreview(document.onvisibilitychange),
      windowOnblur: functionPreview(window.onblur),
      windowOnfocus: functionPreview(window.onfocus),
      windowOnpagehide: functionPreview(window.onpagehide),
      bodyOnblurAttr: document.body?.getAttribute?.("onblur") ?? null,
      bodyOnfocusAttr: document.body?.getAttribute?.("onfocus") ?? null,
      bodyOnmouseleaveAttr: document.body?.getAttribute?.("onmouseleave") ?? null
    },
    cspEvalProbe: {
      allowed: evalAllowed,
      error: evalError
    },
    pageTextSignals: {
      checkedLength: bodyText.length,
      matches: textSignals
    },
    scriptSignals: {
      checkedScripts: scripts.length,
      matches: scriptSignals
    },
    note: "只读诊断：浏览器不会暴露 addEventListener 注册列表，因此报告只包含 DOM/属性/脚本文本中可直接观察到的证据。"
  };

  return JSON.stringify(report, null, 2);
}

function agentWaitForElement(args: Record<string, unknown>): Promise<string> {
  const selector = typeof args.selector === "string" ? args.selector : "";
  const timeout = typeof args.timeout === "number" ? args.timeout : 5000;
  if (!selector) return Promise.resolve("Error: selector is required");

  // Check immediately
  if (document.querySelector(selector)) {
    return Promise.resolve(`Element found: ${selector}`);
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(`Element found: ${selector}`);
      } else if (Date.now() - startTime >= timeout) {
        observer.disconnect();
        resolve(`Timeout waiting for element: ${selector} (${timeout}ms)`);
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true
    });
    setTimeout(() => {
      observer.disconnect();
      if (document.querySelector(selector)) {
        resolve(`Element found: ${selector}`);
      } else {
        resolve(`Timeout waiting for element: ${selector} (${timeout}ms)`);
      }
    }, timeout);
  });
}

function agentGetFormData(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "form";
  const form = document.querySelector<HTMLFormElement>(selector);
  if (!form) return `No form found for selector: ${selector}`;

  const fields: Array<{ name: string; type: string; value: string; label: string }> = [];
  const inputs = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input, textarea, select"
  ));

  for (const input of inputs) {
    const name = input.name || input.id || "";
    const type = input.type || input.tagName.toLowerCase();
    const value = input.value || "";
    const labelEl = input.id
      ? document.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)
      : null;
    const labelText = labelEl?.textContent?.trim() ?? "";
    fields.push({ name, type, value, label: labelText });
  }

  if (fields.length === 0) return "No form fields found";

  return fields
    .map((f) => {
      let line = `${f.name || "(unnamed)"} [${f.type}]`;
      if (f.label) line += ` label="${f.label}"`;
      if (f.value) line += ` value="${f.value}"`;
      return line;
    })
    .join("\n");
}

function agentPressKey(args: Record<string, unknown>): string {
  const key = typeof args.key === "string" ? args.key : "";
  const selector = typeof args.selector === "string" ? args.selector : undefined;
  if (!key) return "Error: key is required";

  const target = selector
    ? document.querySelector<HTMLElement>(selector)
    : (document.activeElement as HTMLElement | null) ?? document.body;
  if (!target) return `No element found for selector: ${selector}`;

  const eventInit: KeyboardEventInit = {
    key,
    code: key,
    bubbles: true,
    cancelable: true
  };
  target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  target.dispatchEvent(new KeyboardEvent("keypress", eventInit));
  target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  return `Pressed key "${key}" on <${target.tagName.toLowerCase()}>`;
}

type ApiTrafficResource = PerformanceResourceTiming & {
  responseStatus?: number;
};

type ApiTrafficSummaryBucket = {
  count: number;
  totalDurationMs: number;
  totalTransferSize: number;
};

const API_TRAFFIC_INITIATOR_TYPES = new Set(["fetch", "xmlhttprequest", "beacon"]);

function isLikelyApiUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return /(^|\/)(api|graphql|rpc|rest|ajax|json|v\d+)(\/|$)/.test(path) ||
    path.endsWith(".json") ||
    url.searchParams.has("graphql") ||
    url.searchParams.has("api");
}

function createApiTrafficUrlMatcher(pattern: unknown): (url: string) => boolean {
  if (typeof pattern !== "string" || !pattern.trim()) {
    return () => true;
  }

  const trimmed = pattern.trim();
  const regexMatch = /^\/(.+)\/([dgimsuvy]*)$/.exec(trimmed);
  if (regexMatch) {
    try {
      const regex = new RegExp(regexMatch[1], regexMatch[2]);
      return (url: string) => regex.test(url);
    } catch {
      // Fall back to substring matching for malformed regex input.
    }
  }

  const needle = trimmed.toLowerCase();
  return (url: string) => url.toLowerCase().includes(needle);
}

function getApiTrafficResources(args: Record<string, unknown>): ApiTrafficResource[] {
  const includeAllResources = args.includeAllResources === true;
  const sinceMs = typeof args.sinceMs === "number" && args.sinceMs > 0 ? args.sinceMs : 0;
  const startedAfter = sinceMs > 0 ? performance.now() - sinceMs : Number.NEGATIVE_INFINITY;
  const matchesUrl = createApiTrafficUrlMatcher(args.urlPattern);

  return performance
    .getEntriesByType("resource")
    .filter((entry): entry is ApiTrafficResource => entry.entryType === "resource")
    .filter((entry) => entry.startTime >= startedAfter)
    .filter((entry) => matchesApiTrafficResource(entry, matchesUrl, includeAllResources));
}

function matchesApiTrafficResource(
  entry: ApiTrafficResource,
  matchesUrl: (url: string) => boolean,
  includeAllResources: boolean
): boolean {
  if (!matchesUrl(entry.name)) return false;
  if (includeAllResources) return true;
  if (API_TRAFFIC_INITIATOR_TYPES.has(entry.initiatorType)) return true;
  try {
    return isLikelyApiUrl(new URL(entry.name, location.href));
  } catch {
    return false;
  }
}

function formatApiTrafficEntry(entry: ApiTrafficResource) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(entry.name, location.href);
  } catch {
    // Keep parsed null for non-standard resource names.
  }

  return {
    url: entry.name,
    origin: parsed?.origin ?? "",
    path: parsed ? `${parsed.pathname}${parsed.search}` : "",
    initiatorType: entry.initiatorType || "unknown",
    startTimeMs: Number(entry.startTime.toFixed(1)),
    ageMs: Number(Math.max(0, performance.now() - entry.startTime).toFixed(1)),
    durationMs: Number(entry.duration.toFixed(1)),
    transferSize: entry.transferSize || 0,
    encodedBodySize: entry.encodedBodySize || 0,
    decodedBodySize: entry.decodedBodySize || 0,
    responseStatus: typeof entry.responseStatus === "number" ? entry.responseStatus : null,
    protocol: entry.nextHopProtocol || ""
  };
}

function addApiTrafficBucket(
  buckets: Record<string, ApiTrafficSummaryBucket>,
  key: string,
  entry: ApiTrafficResource
): void {
  const bucket = buckets[key] ?? {
    count: 0,
    totalDurationMs: 0,
    totalTransferSize: 0
  };
  bucket.count += 1;
  bucket.totalDurationMs += entry.duration;
  bucket.totalTransferSize += entry.transferSize || 0;
  buckets[key] = bucket;
}

function sortApiTrafficBuckets(buckets: Record<string, ApiTrafficSummaryBucket>) {
  return Object.entries(buckets)
    .map(([key, bucket]) => ({
      key,
      count: bucket.count,
      totalDurationMs: Number(bucket.totalDurationMs.toFixed(1)),
      avgDurationMs: Number((bucket.totalDurationMs / bucket.count).toFixed(1)),
      totalTransferSize: bucket.totalTransferSize
    }))
    .sort((a, b) => b.count - a.count || b.totalTransferSize - a.totalTransferSize);
}

function agentListApiTraffic(args: Record<string, unknown>): string {
  const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 200) : 50;
  const resources = getApiTrafficResources(args)
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, limit)
    .map(formatApiTrafficEntry);

  return JSON.stringify({
    pageUrl: location.href,
    count: resources.length,
    note: "数据来自 Performance Resource Timing；部分站点可能因缓存、跨域 Timing-Allow-Origin 或浏览器限制导致状态码/大小为 0 或 null。",
    requests: resources
  }, null, 2);
}

function agentAnalyzeApiTraffic(args: Record<string, unknown>): string {
  const topN = typeof args.topN === "number" && args.topN > 0 ? Math.min(args.topN, 50) : 10;
  const resources = getApiTrafficResources(args);
  const byHost: Record<string, ApiTrafficSummaryBucket> = {};
  const byEndpoint: Record<string, ApiTrafficSummaryBucket> = {};
  const byStatus: Record<string, ApiTrafficSummaryBucket> = {};
  const byInitiatorType: Record<string, ApiTrafficSummaryBucket> = {};

  let totalDurationMs = 0;
  let totalTransferSize = 0;
  let totalEncodedBodySize = 0;
  let totalDecodedBodySize = 0;

  for (const entry of resources) {
    totalDurationMs += entry.duration;
    totalTransferSize += entry.transferSize || 0;
    totalEncodedBodySize += entry.encodedBodySize || 0;
    totalDecodedBodySize += entry.decodedBodySize || 0;

    let parsed: URL | null = null;
    try {
      parsed = new URL(entry.name, location.href);
    } catch {
      // Keep unparseable entries grouped under unknown.
    }

    const host = parsed?.host ?? "unknown";
    const endpoint = parsed ? `${parsed.origin}${parsed.pathname}` : entry.name;
    const status = typeof entry.responseStatus === "number" ? String(entry.responseStatus) : "unknown";
    const initiatorType = entry.initiatorType || "unknown";

    addApiTrafficBucket(byHost, host, entry);
    addApiTrafficBucket(byEndpoint, endpoint, entry);
    addApiTrafficBucket(byStatus, status, entry);
    addApiTrafficBucket(byInitiatorType, initiatorType, entry);
  }

  const slowest = [...resources]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, topN)
    .map(formatApiTrafficEntry);
  const largest = [...resources]
    .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
    .slice(0, topN)
    .map(formatApiTrafficEntry);

  return JSON.stringify({
    pageUrl: location.href,
    totalRequests: resources.length,
    totalDurationMs: Number(totalDurationMs.toFixed(1)),
    avgDurationMs: resources.length > 0 ? Number((totalDurationMs / resources.length).toFixed(1)) : 0,
    totalTransferSize,
    totalEncodedBodySize,
    totalDecodedBodySize,
    byHost: sortApiTrafficBuckets(byHost),
    byEndpoint: sortApiTrafficBuckets(byEndpoint).slice(0, topN),
    byStatus: sortApiTrafficBuckets(byStatus),
    byInitiatorType: sortApiTrafficBuckets(byInitiatorType),
    slowest,
    largest,
    note: "数据来自 Performance Resource Timing；无法读取请求/响应正文，部分状态码和大小可能因浏览器或跨域限制不可用。"
  }, null, 2);
}

function agentWaitForApiTraffic(args: Record<string, unknown>): Promise<string> {
  const urlPattern = typeof args.urlPattern === "string" ? args.urlPattern.trim() : "";
  if (!urlPattern) return Promise.resolve("Error: urlPattern is required");

  const timeout = typeof args.timeout === "number" && args.timeout > 0 ? args.timeout : 5000;
  const includeExisting = args.includeExisting !== false;
  const includeAllResources = args.includeAllResources === true;
  const matchesUrl = createApiTrafficUrlMatcher(urlPattern);

  if (includeExisting) {
    const existing = getApiTrafficResources(args)
      .sort((a, b) => b.startTime - a.startTime)[0];
    if (existing) {
      return Promise.resolve(JSON.stringify({
        matchedExisting: true,
        request: formatApiTrafficEntry(existing)
      }, null, 2));
    }
  }

  if (typeof PerformanceObserver !== "function") {
    return Promise.resolve("Error: PerformanceObserver is not available in this page");
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (output: string): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(output);
    };

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType !== "resource") continue;
        const resource = entry as ApiTrafficResource;
        if (!matchesApiTrafficResource(resource, matchesUrl, includeAllResources)) {
          continue;
        }
        finish(JSON.stringify({
          matchedExisting: false,
          request: formatApiTrafficEntry(resource)
        }, null, 2));
        return;
      }
    });

    const timer = setTimeout(() => {
      finish(`Timeout waiting for API traffic matching "${urlPattern}" (${timeout}ms)`);
    }, timeout);

    try {
      observer.observe({ entryTypes: ["resource"] });
    } catch (error) {
      finish(`Error: cannot observe resource timing (${error instanceof Error ? error.message : String(error)})`);
    }
  });
}

function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>
): string | Promise<string> {
  switch (toolName) {
    case "get_page_info":
      return JSON.stringify(agentGetPageInfo());
    case "read_page_content":
      return agentReadPageContent(args);
    case "query_selector":
      return agentQuerySelector(args);
    case "click_element":
      return agentClickElement(args);
    case "query_canvas":
      return agentQueryCanvas(args);
    case "inspect_canvas_pixel":
      return agentInspectCanvasPixel(args);
    case "click_canvas":
      return agentClickCanvas(args);
    case "click_canvas_cell":
      return agentClickCanvasCell(args);
    case "translate_current_page":
      return agentTranslateCurrentPage();
    case "write_translation_to_page":
      return agentWriteTranslationToPage(args);
    case "remove_translation_from_page":
      return agentRemoveTranslationFromPage(args);
    case "update_translation_on_page":
      return agentUpdateTranslationOnPage(args);
    case "write_bilingual_translation_to_page":
      return agentWriteBilingualTranslationToPage(args);
    case "update_bilingual_translation_on_page":
      return agentUpdateBilingualTranslationOnPage(args);
    case "insert_text_block":
      return agentInsertTextBlock(args);
    case "type_text":
      return agentTypeText(args);
    case "select_option":
      return agentSelectOption(args);
    case "scroll_page":
      return agentScrollPage(args);
    case "execute_script":
      return agentExecuteScript(args);
    case "inspect_visibility_detection":
      return agentInspectVisibilityDetection(args);
    case "wait_for_element":
      return agentWaitForElement(args);
    case "get_form_data":
      return agentGetFormData(args);
    case "press_key":
      return agentPressKey(args);
    case "list_api_traffic":
      return agentListApiTraffic(args);
    case "analyze_api_traffic":
      return agentAnalyzeApiTraffic(args);
    case "wait_for_api_traffic":
      return agentWaitForApiTraffic(args);
    default:
      return `Unknown tool: ${toolName}`;
  }
}

function createContentMessageHandler(options?: {
  getContext?: () => string;
  applyFlags?: (flags: FeatureFlags) => void;
}) {
  const getContext = options?.getContext ?? buildPageContext;
  const applyFlags = options?.applyFlags ?? applyFeatureFlags;

  return (message: { type?: string; payload?: unknown }, _sender: unknown, sendResponse: (response: unknown) => void) => {
    if (message.type === "PING") {
      sendResponse({ ok: true, data: "PONG" });
      return;
    }

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

    if (message.type === "APPLY_TRANSLATION_SETTINGS") {
      const payload = message.payload as Partial<LLMConfig> | undefined;
      applyTranslationSettings(translationSettingsFromConfig(payload ?? {}));
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "TRANSLATE_CURRENT_PAGE_ONCE") {
      const payload = message.payload as Partial<LLMConfig> | undefined;
      const result = translateCurrentPageOnce(translationSettingsFromConfig({
        ...(payload ?? {}),
        translationEnabled: true
      }));
      sendResponse({ ok: true, data: result });
      return;
    }

    if (message.type === "CHECK_CURRENT_PAGE_TRANSLATION_STATUS") {
      const payload = message.payload as Partial<LLMConfig> | undefined;
      const settings = translationSettingsFromConfig({
        ...(payload ?? {}),
        translationEnabled: true
      });
      const signature = buildPageTranslationSignature(settings);
      sendResponse({
        ok: true,
        data: {
          translated: isPageAlreadyTranslated(settings),
          count: translationRecords.size,
          signature
        }
      });
      return;
    }

    if (message.type === "APPLY_AUTO_SOLVE_SETTINGS") {
      const payload = message.payload as { autoSolveCurrentPage?: boolean } | undefined;
      applyAutoSolveCurrentPage(!!payload?.autoSolveCurrentPage);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "CLEAR_TRANSLATIONS") {
      applyTranslationSettings({
        ...translationSettings,
        enabled: false
      });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "GET_EXAM_QUESTIONS") {
      sendResponse({ ok: true, data: collectExamQuestionsFromPage() });
      return;
    }

    if (message.type === "APPLY_EXAM_ANSWERS") {
      const payload = message.payload as { matches?: ExamAnswerMatch[] } | undefined;
      sendResponse({ ok: true, data: applyExamAnswersToPage(payload?.matches ?? []) });
      return;
    }

    if (message.type === "AGENT_TOOL_EXECUTE") {
      const payload = message.payload as { toolName?: string; arguments?: Record<string, unknown> } | undefined;
      if (!payload?.toolName) {
        sendResponse({ ok: false, errors: ["toolName is required"] });
        return;
      }
      const result = executeAgentTool(payload.toolName, payload.arguments ?? {});
      if (result instanceof Promise) {
        void result.then((output) => {
          sendResponse({ ok: true, data: output });
        }).catch((error) => {
          sendResponse({ ok: true, data: `Error: ${error instanceof Error ? error.message : String(error)}` });
        });
        return true as unknown as void; // Keep sendResponse channel open for async
      }
      sendResponse({ ok: true, data: result });
      return;
    }

    sendResponse({ ok: false, errors: ["Unknown message type"] });
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(createContentMessageHandler());

  void (async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "GET_CONFIG" });
      if (response?.ok) {
        const config = response.data as Partial<LLMConfig>;
        applyFeatureFlags(flagsFromConfig(config));
        applyTranslationSettings(translationSettingsFromConfig(config));
        applyAutoSolveCurrentPage(!!config.autoSolveCurrentPage);
      }
    } catch {
      // ignored
    }
  })();
}
