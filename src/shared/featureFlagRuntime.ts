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

function overrideProperty(target: object, key: "visibilityState" | "hidden", value: string | boolean): () => void {
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
