import { describe, expect, it, vi } from "vitest";
import {
  createContextMenuUnlockRuntime,
  createVisibilityBypassRuntime
} from "../src/shared/featureFlagRuntime";

class FakeEventTarget {
  addEventListener = vi.fn();
  removeEventListener = vi.fn();

  onblur: EventListener | null = () => {};
  onfocus: EventListener | null = () => {};
  onpagehide: EventListener | null = () => {};
  onfreeze: EventListener | null = () => {};
  onvisibilitychange: EventListener | null = () => {};
}

class FakeStyleTarget {
  style = {
    userSelect: "none",
    webkitUserSelect: "none"
  };
}

class FakeStyleElement {
  id = "";
  textContent = "";

  constructor(private readonly onRemove: (id: string) => void) {}

  remove = vi.fn(() => {
    this.onRemove(this.id);
  });
}

class FakeStyleHost {
  readonly nodes = new Map<string, FakeStyleElement>();

  head = {
    appendChild: vi.fn((node: FakeStyleElement) => {
      this.nodes.set(node.id, node);
    })
  };

  getElementById = vi.fn((id: string) => {
    return this.nodes.get(id) ?? null;
  });

  createElement = vi.fn((_tagName: string) => {
    return new FakeStyleElement((id) => {
      this.nodes.delete(id);
    });
  });
}

describe("feature flag runtime", () => {
  it("registers and removes context menu related blockers", () => {
    const windowTarget = new FakeEventTarget();
    const documentTarget = new FakeEventTarget();
    const rootTarget = new FakeEventTarget();
    const styleTarget = new FakeStyleTarget();
    const cleanup = createContextMenuUnlockRuntime({
      windowTarget,
      documentTarget,
      rootTarget,
      styleTarget
    });

    expect(windowTarget.addEventListener).toHaveBeenCalledTimes(4);
    expect(documentTarget.addEventListener).toHaveBeenCalledTimes(4);
    expect(rootTarget.addEventListener).toHaveBeenCalledTimes(4);
    expect(styleTarget.style.userSelect).toBe("text");
    expect(styleTarget.style.webkitUserSelect).toBe("text");

    expect(windowTarget.addEventListener).toHaveBeenNthCalledWith(
      1,
      "contextmenu",
      expect.any(Function),
      true
    );
    expect(windowTarget.addEventListener).toHaveBeenNthCalledWith(2, "copy", expect.any(Function), true);
    expect(windowTarget.addEventListener).toHaveBeenNthCalledWith(3, "paste", expect.any(Function), true);
    expect(windowTarget.addEventListener).toHaveBeenNthCalledWith(
      4,
      "selectstart",
      expect.any(Function),
      true
    );

    cleanup();

    expect(windowTarget.removeEventListener).toHaveBeenCalledTimes(4);
    expect(documentTarget.removeEventListener).toHaveBeenCalledTimes(4);
    expect(rootTarget.removeEventListener).toHaveBeenCalledTimes(4);
    expect(styleTarget.style.userSelect).toBe("none");
    expect(styleTarget.style.webkitUserSelect).toBe("none");

    expect(windowTarget.removeEventListener).toHaveBeenNthCalledWith(
      1,
      "contextmenu",
      expect.any(Function),
      true
    );
  });

  it("injects and cleans up selection unlock css", () => {
    const windowTarget = new FakeEventTarget();
    const documentTarget = new FakeEventTarget();
    const styleHost = new FakeStyleHost();

    const cleanup = createContextMenuUnlockRuntime({
      windowTarget,
      documentTarget,
      styleHost
    });

    const style = styleHost.nodes.get("neonagent-selection-unlock-style");
    expect(style).toBeDefined();
    expect(style?.textContent).toContain("user-select: text !important");

    cleanup();

    expect(style?.remove).toHaveBeenCalledTimes(1);
    expect(styleHost.nodes.has("neonagent-selection-unlock-style")).toBe(false);
  });

  it("forces visible state and restores properties on cleanup", () => {
    const documentTarget = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const originalHasFocus = vi.fn(() => false);
    const visibilityHost: { visibilityState?: string; hidden?: boolean; hasFocus?: () => boolean } = {
      visibilityState: "hidden",
      hidden: true,
      hasFocus: originalHasFocus
    };

    const cleanup = createVisibilityBypassRuntime({
      documentTarget,
      windowTarget,
      visibilityHost
    });

    expect(documentTarget.addEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
      true
    );
    expect(documentTarget.addEventListener).toHaveBeenCalledWith(
      "webkitvisibilitychange",
      expect.any(Function),
      true
    );
    expect(documentTarget.addEventListener).toHaveBeenCalledWith(
      "mozvisibilitychange",
      expect.any(Function),
      true
    );
    expect(documentTarget.addEventListener).toHaveBeenCalledWith(
      "msvisibilitychange",
      expect.any(Function),
      true
    );
    expect(windowTarget.addEventListener).toHaveBeenCalledWith("blur", expect.any(Function), true);
    expect(windowTarget.addEventListener).toHaveBeenCalledWith("focus", expect.any(Function), true);
    expect(windowTarget.addEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function), true);
    expect(windowTarget.addEventListener).toHaveBeenCalledWith("freeze", expect.any(Function), true);
    expect(visibilityHost.visibilityState).toBe("visible");
    expect(visibilityHost.hidden).toBe(false);
    expect(visibilityHost.hasFocus?.()).toBe(true);

    cleanup();

    expect(visibilityHost.visibilityState).toBe("hidden");
    expect(visibilityHost.hidden).toBe(true);
    expect(visibilityHost.hasFocus).toBe(originalHasFocus);
    expect(documentTarget.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
      true
    );
    expect(documentTarget.removeEventListener).toHaveBeenCalledWith(
      "webkitvisibilitychange",
      expect.any(Function),
      true
    );
    expect(documentTarget.removeEventListener).toHaveBeenCalledWith(
      "mozvisibilitychange",
      expect.any(Function),
      true
    );
    expect(documentTarget.removeEventListener).toHaveBeenCalledWith(
      "msvisibilitychange",
      expect.any(Function),
      true
    );
    expect(windowTarget.removeEventListener).toHaveBeenCalledWith("blur", expect.any(Function), true);
    expect(windowTarget.removeEventListener).toHaveBeenCalledWith("focus", expect.any(Function), true);
    expect(windowTarget.removeEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function), true);
    expect(windowTarget.removeEventListener).toHaveBeenCalledWith("freeze", expect.any(Function), true);
  });

  it("enables aggressive blockers only when aggressive mode is true", () => {
    const documentTarget = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const visibilityHost: { visibilityState?: string; hidden?: boolean; hasFocus?: () => boolean } = {
      visibilityState: "hidden",
      hidden: true,
      hasFocus: () => false
    };

    const originalWindowBlur = windowTarget.onblur;
    const originalWindowFocus = windowTarget.onfocus;
    const originalPageHide = windowTarget.onpagehide;
    const originalFreeze = windowTarget.onfreeze;
    const originalVisibilityChange = documentTarget.onvisibilitychange;

    const cleanup = createVisibilityBypassRuntime({
      documentTarget,
      windowTarget,
      visibilityHost,
      aggressive: true
    });

    expect(windowTarget.addEventListener).toHaveBeenCalledTimes(8);
    expect(documentTarget.addEventListener).toHaveBeenCalledTimes(8);
    expect(windowTarget.onblur).toBeNull();
    expect(windowTarget.onfocus).toBeNull();
    expect(windowTarget.onpagehide).toBeNull();
    expect(windowTarget.onfreeze).toBeNull();
    expect(documentTarget.onvisibilitychange).toBeNull();

    cleanup();

    expect(windowTarget.onblur).toBe(originalWindowBlur);
    expect(windowTarget.onfocus).toBe(originalWindowFocus);
    expect(windowTarget.onpagehide).toBe(originalPageHide);
    expect(windowTarget.onfreeze).toBe(originalFreeze);
    expect(documentTarget.onvisibilitychange).toBe(originalVisibilityChange);
  });
});
