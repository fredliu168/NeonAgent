type EventTargetLike = {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void;
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

function overrideProperty(target: object, key: string, value: string | boolean | number): () => void {
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

function overrideGetter(target: object, key: string, get: () => unknown): () => void {
  const ownDescriptor = Object.getOwnPropertyDescriptor(target, key);

  try {
    Object.defineProperty(target, key, {
      configurable: true,
      get
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

export function createContextMenuUnlockRuntime(input: {
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

export function createVisibilityBypassRuntime(input: {
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

export function createFullscreenBlockRuntime(input: {
  elementPrototype: object;
  documentTarget: FullscreenDocumentLike;
}): () => void {
  const cleaners: Array<() => void> = [];
  const blockedRequest = (() => Promise.reject(new DOMException("Fullscreen requests are blocked by NeonAgent", "NotAllowedError"))) as () => Promise<void>;

  const requestMethods = [
    "requestFullscreen",
    "webkitRequestFullscreen",
    "webkitRequestFullScreen",
    "mozRequestFullScreen",
    "msRequestFullscreen"
  ] as const;

  for (const method of requestMethods) {
    if (method in input.elementPrototype) {
      cleaners.push(overrideFunction(input.elementPrototype as Record<string, unknown>, method, blockedRequest));
    }
  }

  const exitFullscreen = (): void => {
    const doc = input.documentTarget;
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
    input.documentTarget.addEventListener(event, exitFullscreen, true);
    cleaners.push(() => input.documentTarget.removeEventListener(event, exitFullscreen, true));
  }

  exitFullscreen();

  return () => {
    cleaners.forEach((fn) => fn());
  };
}

function sanitizeDevtoolsConsoleArg(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  return "[object]";
}

export function createDevtoolsDetectionBlockRuntime(input: {
  windowTarget: EventTargetLike & Record<string, unknown>;
  consoleTarget?: Record<string, unknown>;
}): () => void {
  const cleaners: Array<() => void> = [];
  const windowRecord = input.windowTarget;

  cleaners.push(addCaptureBlocker(input.windowTarget, "devtoolschange"));
  cleaners.push(overrideGetter(windowRecord, "outerWidth", () => Number(windowRecord.innerWidth) || 0));
  cleaners.push(overrideGetter(windowRecord, "outerHeight", () => Number(windowRecord.innerHeight) || 0));
  cleaners.push(overrideProperty(windowRecord, "devtools", false));
  cleaners.push(overrideFunction(windowRecord, "clearLog", () => undefined));

  const consoleTarget = input.consoleTarget;
  if (consoleTarget) {
    cleaners.push(overrideFunction(consoleTarget, "clear", () => undefined));

    const methods = ["log", "info", "debug", "warn", "error", "dir", "table", "trace"] as const;
    for (const method of methods) {
      const original = consoleTarget[method];
      if (typeof original !== "function") {
        continue;
      }

      const wrapped = function (this: unknown, ...args: unknown[]) {
        return original.apply(this, args.map(sanitizeDevtoolsConsoleArg));
      };
      cleaners.push(overrideFunction(consoleTarget, method, wrapped));
    }
  }

  return () => {
    cleaners.forEach((fn) => fn());
  };
}
