type FeatureFlags = {
  unlockContextMenu: boolean;
  blockVisibilityDetection: boolean;
  aggressiveVisibilityBypass: boolean;
  enableFloatingBall: boolean;
};

type LLMConfig = {
  unlockContextMenu: boolean;
  blockVisibilityDetection: boolean;
  aggressiveVisibilityBypass: boolean;
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

const defaultFeatureFlags: FeatureFlags = {
  unlockContextMenu: false,
  blockVisibilityDetection: false,
  aggressiveVisibilityBypass: false,
  enableFloatingBall: false
};

const cleanupFns: Array<() => void> = [];

function buildPageContext(): string {
  const title = document.title || "Untitled";
  const selected = window.getSelection()?.toString().trim() || "";
  const text = selected || document.body?.innerText?.slice(0, 800) || "";

  return `Title: ${title}\n\nContext:\n${text}`.trim();
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function resolveExamQuestionRoots(): HTMLElement[] {
  const explicit = Array.from(document.querySelectorAll<HTMLElement>(".question-item"));
  if (explicit.length > 0) {
    return explicit;
  }

  const generic = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-question-id], [class*="question" i], [id*="question" i], [class*="topic" i]'
    )
  );

  if (generic.length > 0) {
    return generic;
  }

  return Array.from(document.querySelectorAll<HTMLElement>("li, section, article, div"))
    .filter((node) => {
      const text = normalizeText(node.innerText || "");
      return /^[0-9]+[.、]\s*/.test(text) && /[A-H][.、:)）\s]/.test(text);
    })
    .slice(0, 20);
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
  const markerRegex = /([A-H])[.、:)）]/gi;
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
      const cut = fullText.search(/[ \n\t][A-H][.、:)）]/);
      rawStem = cut > 0 ? fullText.slice(0, cut) : fullText;
    }
    const stem = normalizeText(rawStem);

    // --- Option node collection ---
    // Scoped: prefer explicit exam-widget option containers; exclude <label>
    // sub-elements (they contain only the letter and cause duplicates).
    const scopedOptionNodes = Array.from(
      node.querySelectorAll<HTMLElement>(
        ".question-attrs-wrap .a-radio, .question-attrs-wrap .a-checkbox, .question-attrs-wrap li"
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

    result.push({
      id: node.dataset.questionId || `q_${i + 1}`,
      stem,
      options,
      questionType: inferQuestionType(node, options)
    });
  }

  return result;
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

  setFloatingBall(flags.enableFloatingBall);
}

function flagsFromConfig(config: Partial<LLMConfig>): FeatureFlags {
  return {
    unlockContextMenu: !!config.unlockContextMenu,
    blockVisibilityDetection: !!config.blockVisibilityDetection,
    aggressiveVisibilityBypass: !!config.aggressiveVisibilityBypass,
    enableFloatingBall: !!config.enableFloatingBall
  };
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
    case "type_text":
      return agentTypeText(args);
    case "select_option":
      return agentSelectOption(args);
    case "scroll_page":
      return agentScrollPage(args);
    case "execute_script":
      return agentExecuteScript(args);
    case "wait_for_element":
      return agentWaitForElement(args);
    case "get_form_data":
      return agentGetFormData(args);
    case "press_key":
      return agentPressKey(args);
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
      }
    } catch {
      // ignored
    }
  })();
}
