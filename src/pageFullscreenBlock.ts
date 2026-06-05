{
const FULLSCREEN_BLOCK_EVENT = "neonagent:set-fullscreen-block";
const FULLSCREEN_BLOCK_STATE_KEY = "__neonagentFullscreenBlock";

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

const fullscreenWindow = window as Window & {
  __neonagentFullscreenBlock?: FullscreenBlockState;
};

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
}
