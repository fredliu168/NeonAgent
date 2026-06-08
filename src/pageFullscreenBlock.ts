{
const FULLSCREEN_BLOCK_EVENT = "neonagent:set-fullscreen-block";
const DEVTOOLS_DETECTION_BLOCK_EVENT = "neonagent:set-devtools-detection-block";
const FULLSCREEN_BLOCK_STATE_KEY = "__neonagentFullscreenBlock";
const DEVTOOLS_DETECTION_BLOCK_STATE_KEY = "__neonagentDevtoolsDetectionBlock";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

type FullscreenBlockState = {
  enabled: boolean;
  originals: Map<string, PropertyDescriptor | null>;
};

type DevtoolsDetectionBlockState = {
  enabled: boolean;
  originals: Map<string, PropertyDescriptor | null>;
  listeners: Array<() => void>;
};

const fullscreenWindow = window as Window & {
  __neonagentFullscreenBlock?: FullscreenBlockState;
  __neonagentDevtoolsDetectionBlock?: DevtoolsDetectionBlockState;
};

function rememberDescriptor(state: { originals: Map<string, PropertyDescriptor | null> }, key: string, target: object, property: string): void {
  if (state.originals.has(key)) return;
  state.originals.set(key, Object.getOwnPropertyDescriptor(target, property) ?? null);
}

function restoreDescriptor(target: object, property: string, descriptor: PropertyDescriptor | null): void {
  try {
    if (descriptor) {
      Object.defineProperty(target, property, descriptor);
    } else {
      delete (target as Record<string, unknown>)[property];
    }
  } catch {
    // ignored
  }
}

function getFullscreenError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("Fullscreen requests are blocked by NeonAgent", "NotAllowedError");
  }
  const error = new Error("Fullscreen requests are blocked by NeonAgent");
  error.name = "NotAllowedError";
  return error;
}

function getRequestTargets(): Array<{ label: string; target: object }> {
  const targets: Array<{ label: string; target: object }> = [];
  const constructors = [Element, HTMLElement, HTMLVideoElement].filter(Boolean);
  for (const ctor of constructors) {
    const prototype = ctor.prototype;
    if (prototype && !targets.some((item) => item.target === prototype)) {
      targets.push({ label: ctor.name, target: prototype });
    }
  }
  return targets;
}

function exitFullscreenIfNeeded(): void {
  const doc = document as FullscreenDocument;
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
}

function installFullscreenBlock(): void {
  const state = fullscreenWindow.__neonagentFullscreenBlock;
  if (!state || state.enabled) return;

  const blockedRequest = () => Promise.reject(getFullscreenError());
  const methods = [
    "requestFullscreen",
    "webkitRequestFullscreen",
    "webkitRequestFullScreen",
    "mozRequestFullScreen",
    "msRequestFullscreen"
  ];

  for (const { label, target } of getRequestTargets()) {
    for (const method of methods) {
      const key = `${label}.${method}`;
      if (state.originals.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(target, method);
      if (!descriptor) {
        state.originals.set(key, null);
        continue;
      }
      state.originals.set(key, descriptor);
      try {
        Object.defineProperty(target, method, {
          ...descriptor,
          configurable: true,
          value: blockedRequest
        });
      } catch {
        // Keep going; some browser-specific descriptors may be non-configurable.
      }
    }
  }

  state.enabled = true;
  exitFullscreenIfNeeded();
}

function uninstallFullscreenBlock(): void {
  const state = fullscreenWindow.__neonagentFullscreenBlock;
  if (!state || !state.enabled) return;

  for (const [key, descriptor] of state.originals.entries()) {
    const separator = key.indexOf(".");
    const label = key.slice(0, separator);
    const method = key.slice(separator + 1);
    const target = getRequestTargets().find((item) => item.label === label)?.target;
    if (!target) continue;

    try {
      if (descriptor) {
        Object.defineProperty(target, method, descriptor);
      } else {
        delete (target as Record<string, unknown>)[method];
      }
    } catch {
      // ignored
    }
  }

  state.originals.clear();
  state.enabled = false;
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

function installDevtoolsDetectionBlock(): void {
  const state = fullscreenWindow.__neonagentDevtoolsDetectionBlock;
  if (!state || state.enabled) return;

  const eventBlocker = (event: Event): void => {
    event.stopImmediatePropagation();
  };
  window.addEventListener("devtoolschange", eventBlocker, true);
  state.listeners.push(() => window.removeEventListener("devtoolschange", eventBlocker, true));

  const dimensionOverrides: Array<[string, () => number]> = [
    ["outerWidth", () => window.innerWidth || 0],
    ["outerHeight", () => window.innerHeight || 0]
  ];

  for (const [property, getter] of dimensionOverrides) {
    rememberDescriptor(state, `window.${property}`, window, property);
    try {
      Object.defineProperty(window, property, {
        configurable: true,
        get: getter
      });
    } catch {
      // Some browser properties may be non-configurable.
    }
  }

  rememberDescriptor(state, "window.devtools", window, "devtools");
  try {
    Object.defineProperty(window, "devtools", {
      configurable: true,
      get: () => false
    });
  } catch {
    // ignored
  }

  rememberDescriptor(state, "window.clearLog", window, "clearLog");
  try {
    Object.defineProperty(window, "clearLog", {
      configurable: true,
      value: () => undefined
    });
  } catch {
    // ignored
  }

  rememberDescriptor(state, "console.clear", console, "clear");
  try {
    Object.defineProperty(console, "clear", {
      configurable: true,
      value: () => undefined
    });
  } catch {
    // ignored
  }

  const consoleMethods = ["log", "info", "debug", "warn", "error", "dir", "table", "trace"];
  for (const method of consoleMethods) {
    const original = (console as unknown as Record<string, unknown>)[method];
    if (typeof original !== "function") continue;

    rememberDescriptor(state, `console.${method}`, console, method);
    try {
      Object.defineProperty(console, method, {
        configurable: true,
        value: function (this: unknown, ...args: unknown[]) {
          return original.apply(this, args.map(sanitizeDevtoolsConsoleArg));
        }
      });
    } catch {
      // ignored
    }
  }

  state.enabled = true;
}

function uninstallDevtoolsDetectionBlock(): void {
  const state = fullscreenWindow.__neonagentDevtoolsDetectionBlock;
  if (!state || !state.enabled) return;

  for (const cleanup of state.listeners.splice(0)) {
    cleanup();
  }

  for (const [key, descriptor] of state.originals.entries()) {
    const separator = key.indexOf(".");
    const targetName = key.slice(0, separator);
    const property = key.slice(separator + 1);
    const target = targetName === "console" ? console : window;
    restoreDescriptor(target, property, descriptor);
  }

  state.originals.clear();
  state.enabled = false;
}

if (!fullscreenWindow.__neonagentFullscreenBlock) {
  fullscreenWindow.__neonagentFullscreenBlock = {
    enabled: false,
    originals: new Map()
  };

  const updateFromEvent = (event: Event): void => {
    const enabled = Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled);
    if (enabled) {
      installFullscreenBlock();
    } else {
      uninstallFullscreenBlock();
    }
  };

  window.addEventListener(FULLSCREEN_BLOCK_EVENT, updateFromEvent);

  for (const eventName of ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"]) {
    document.addEventListener(eventName, () => {
      if (fullscreenWindow.__neonagentFullscreenBlock?.enabled) {
        exitFullscreenIfNeeded();
      }
    }, true);
  }
}

if (!fullscreenWindow.__neonagentDevtoolsDetectionBlock) {
  fullscreenWindow.__neonagentDevtoolsDetectionBlock = {
    enabled: false,
    originals: new Map(),
    listeners: []
  };

  const updateDevtoolsBlockFromEvent = (event: Event): void => {
    const enabled = Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled);
    if (enabled) {
      installDevtoolsDetectionBlock();
    } else {
      uninstallDevtoolsDetectionBlock();
    }
  };

  window.addEventListener(DEVTOOLS_DETECTION_BLOCK_EVENT, updateDevtoolsBlockFromEvent);
}
}
