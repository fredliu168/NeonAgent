import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RegisteredHandler = (
  message: { type?: string; payload?: unknown },
  sender: unknown,
  sendResponse: (response: unknown) => void
) => void;

type MockCanvas = {
  tagName: string;
  id: string;
  className: string;
  width: number;
  height: number;
  focus: ReturnType<typeof vi.fn>;
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
  getContext: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
};

type MockElement = {
  tagName: string;
  id: string;
  className: string;
  innerText: string;
  textContent: string;
  style: Record<string, string>;
  isConnected: boolean;
  dataset: Record<string, string>;
  __attrs: Map<string, string>;
  __listeners?: Map<string, Array<(event: { preventDefault: () => void; stopPropagation: () => void }) => void>>;
  __shadow?: { children: unknown[]; appendChild: (node: unknown) => unknown };
  children?: MockElement[];
  parentElement?: unknown;
  disabled?: boolean;
  type?: string;
  getBoundingClientRect?: () => { left: number; top: number; width: number; height: number; bottom: number };
  focus?: ReturnType<typeof vi.fn>;
  dispatchEvent?: ReturnType<typeof vi.fn>;
  closest: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  appendChild?: ReturnType<typeof vi.fn>;
  click?: ReturnType<typeof vi.fn>;
  querySelector?: ReturnType<typeof vi.fn>;
  querySelectorAll?: ReturnType<typeof vi.fn>;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  removeAttribute: (name: string) => void;
  insertAdjacentElement: ReturnType<typeof vi.fn>;
  attachShadow?: () => { children: unknown[]; appendChild: (node: unknown) => unknown };
  remove?: ReturnType<typeof vi.fn>;
};

function installEventMocks() {
  class FakeMouseEvent {
    type: string;

    constructor(type: string, init: Record<string, unknown> = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  }

  class FakePointerEvent extends FakeMouseEvent {}

  Object.assign(globalThis, {
    MouseEvent: FakeMouseEvent,
    PointerEvent: FakePointerEvent
  });
}

describe("content canvas tools", () => {
  let registeredHandler: RegisteredHandler | undefined;
  let canvas: MockCanvas;
  let paragraph: MockElement;
  let questionTypeItem: MockElement;
  let container: MockElement;
  let textarea: MockElement;
  let sendButton: MockElement;
  let form: MockElement;
  let insertedHosts: MockElement[];
  let mutationObservers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    installEventMocks();
    insertedHosts = [];
    mutationObservers = [];

    canvas = {
      tagName: "CANVAS",
      id: "board",
      className: "board",
      width: 800,
      height: 800,
      focus: vi.fn(),
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 400 }),
      getContext: vi.fn(() => ({
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([12, 34, 56, 255]) }))
      })),
      dispatchEvent: vi.fn(() => true)
    };

    paragraph = {
      tagName: "P",
      id: "",
      className: "",
      innerText: "Hello world",
      textContent: "Hello world",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      focus: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      getBoundingClientRect: () => ({ left: 20, top: 30, width: 320, height: 40, bottom: 70 }),
      closest: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn((_position: string, host: MockElement) => {
        insertedHosts.push(host);
        return host;
      })
    };

    questionTypeItem = {
      tagName: "DIV",
      id: "",
      className: "question-type-item",
      innerText: "单选题\n示例内容",
      textContent: "单选题 示例内容",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map([
        ["data-kind", "single"]
      ]),
      focus: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      getBoundingClientRect: () => ({ left: 60, top: 80, width: 240, height: 48, bottom: 128 }),
      closest: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn()
    };

    container = {
      tagName: "DIV",
      id: "",
      className: "ease container",
      innerText: "Container body",
      textContent: "Container body",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      focus: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      closest: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn((_position: string, host: MockElement) => {
        insertedHosts.push(host);
        return host;
      })
    };

    sendButton = {
      tagName: "BUTTON",
      id: "send_button",
      className: "",
      innerText: "发送",
      textContent: "发送",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      focus: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      getBoundingClientRect: () => ({ left: 100, top: 120, width: 80, height: 32, bottom: 152 }),
      closest: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn()
    };

    form = {
      tagName: "FORM",
      id: "reply_form",
      className: "",
      innerText: "回复 发送",
      textContent: "回复 发送",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      focus: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      querySelectorAll: vi.fn(() => [sendButton]),
      closest: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn()
    };

    textarea = {
      tagName: "TEXTAREA",
      id: "reply_textarea",
      className: "",
      innerText: "",
      textContent: "",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      focus: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      getBoundingClientRect: () => ({ left: 40, top: 60, width: 300, height: 80, bottom: 140 }),
      closest: vi.fn((selector: string) => selector === "form" ? form : null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn()
    };

    class FakeMutationObserver {
      constructor(_callback: MutationCallback) {
        mutationObservers.push(this);
      }

      observe = vi.fn();
      disconnect = vi.fn();
    }

    Object.assign(globalThis, {
      document: {
        querySelectorAll: vi.fn((selector: string) => {
          if (selector === "canvas.board" || selector === "canvas") {
            return [canvas];
          }
          if (selector === "textarea#reply_textarea") {
            return [textarea];
          }
          if (selector === "p") {
            return [paragraph];
          }
          if (selector === ".question-type-item") {
            return [questionTypeItem];
          }
          if (selector === "div.ease.container") {
            return [container];
          }
          if (selector === "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, header") {
            return [paragraph];
          }
          if (selector === "[data-neonagent-translation-source]") {
            return paragraph.hasAttribute("data-neonagent-translation-source") ? [paragraph] : [];
          }
          return [];
        }),
        querySelector: vi.fn(() => null),
        getElementById: vi.fn(() => null),
        createElement: vi.fn((tagName: string) => {
          const element: MockElement = {
            tagName: tagName.toUpperCase(),
            id: "",
            className: "",
            innerText: "",
            textContent: "",
            style: {},
            isConnected: true,
            dataset: {},
            __attrs: new Map(),
            __listeners: new Map(),
            children: [],
            closest: vi.fn(() => null),
            addEventListener: vi.fn(function (
              this: MockElement,
              type: string,
              listener: (event: { preventDefault: () => void; stopPropagation: () => void }) => void
            ) {
              const listeners = this.__listeners?.get(type) ?? [];
              listeners.push(listener);
              this.__listeners?.set(type, listeners);
            }),
            removeEventListener: vi.fn(),
            appendChild: vi.fn(function (this: MockElement, node: MockElement) {
              this.children?.push(node);
              this.textContent = `${this.textContent}${node.textContent ?? ""}`;
              return node;
            }),
            click: vi.fn(function (this: MockElement) {
              this.__listeners?.get("click")?.forEach((listener) => {
                listener({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
              });
            }),
            setAttribute(name: string, value: string) {
              this.__attrs.set(name, value);
            },
            getAttribute(name: string) {
              return this.__attrs.get(name) ?? null;
            },
            hasAttribute(name: string) {
              return this.__attrs.has(name);
            },
            removeAttribute(name: string) {
              this.__attrs.delete(name);
            },
            insertAdjacentElement: vi.fn(),
            remove: vi.fn()
          };

          if (tagName === "div") {
            element.attachShadow = () => {
              const shadow = {
                children: [] as unknown[],
                appendChild(node: unknown) {
                  shadow.children.push(node);
                  return node;
                }
              };
              element.__shadow = shadow;
              return shadow;
            };
          }

          return element;
        }),
        head: { appendChild: vi.fn() },
        documentElement: { appendChild: vi.fn() },
        body: {
          appendChild: vi.fn((host: MockElement) => {
            host.parentElement = (globalThis as { document: { body: unknown } }).document.body;
            insertedHosts.push(host);
            return host;
          })
        },
        title: "Board",
        elementFromPoint: vi.fn(() => paragraph),
        dispatchEvent: vi.fn(() => true),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      },
      location: { href: "https://example.com/game" },
      window: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        scrollBy: vi.fn(),
        scrollTo: vi.fn(),
        setTimeout,
        getSelection: vi.fn(() => null),
        getComputedStyle: vi.fn((element: MockElement) => ({
          color: "rgb(180, 180, 180)",
          backgroundColor: element === paragraph ? "rgb(10, 12, 16)" : "transparent"
        })),
        scrollX: 0,
        scrollY: 0
      },
      MutationObserver: FakeMutationObserver,
      chrome: {
        runtime: {
          onMessage: {
            addListener: vi.fn((handler: RegisteredHandler) => {
              registeredHandler = handler;
            })
          },
          connect: vi.fn(() => {
            const listeners: Array<(message: { type?: string; delta?: string; text?: string }) => void> = [];
            return {
              onMessage: {
                addListener: vi.fn((listener: (message: { type?: string; delta?: string; text?: string }) => void) => {
                  listeners.push(listener);
                })
              },
              onDisconnect: {
                addListener: vi.fn()
              },
              postMessage: vi.fn(() => {
                queueMicrotask(() => {
                  listeners.forEach((listener) => listener({ type: "delta", delta: "你好" }));
                  listeners.forEach((listener) => listener({ type: "delta", delta: "世界" }));
                  listeners.forEach((listener) => listener({ type: "done", text: "译文：你好世界" }));
                });
              }),
              disconnect: vi.fn()
            };
          }),
          sendMessage: vi.fn((message: { type?: string }) => {
            if (message.type === "TRANSLATE_SEGMENTS") {
              return Promise.resolve({ ok: true, data: { translations: ["翻译结果：你好世界"] } });
            }
            return Promise.resolve({ ok: false });
          })
        }
      }
    });

    await import("../src/content.ts");
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).location;
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).chrome;
    delete (globalThis as Record<string, unknown>).MouseEvent;
    delete (globalThis as Record<string, unknown>).PointerEvent;
    delete (globalThis as Record<string, unknown>).MutationObserver;
    registeredHandler = undefined;
  });

  it("click_canvas dispatches pointer and mouse events at CSS coordinates", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "click_canvas",
          arguments: {
            selector: "canvas.board",
            x: 120,
            y: 80
          }
        }
      },
      {},
      sendResponse
    );

    const dispatchedTypes = canvas.dispatchEvent.mock.calls.map(([event]) => event.type);
    expect(dispatchedTypes).toEqual([
      "pointermove",
      "pointerdown",
      "mousemove",
      "mousedown",
      "pointerup",
      "mouseup",
      "click"
    ]);

    const clickEvent = canvas.dispatchEvent.mock.calls.at(-1)?.[0] as { clientX: number; clientY: number };
    expect(clickEvent.clientX).toBe(130);
    expect(clickEvent.clientY).toBe(100);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Clicked canvas canvas.board[0] at (120.0, 80.0) using css coordinates"
    });
  });

  it("click_element dispatches a real pointer and mouse click sequence", () => {
    const sendResponse = vi.fn();
    const doc = globalThis.document as unknown as {
      dispatchEvent: ReturnType<typeof vi.fn>;
    };

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "click_element",
          arguments: {
            selector: "p"
          }
        }
      },
      {},
      sendResponse
    );

    const dispatchedTypes = paragraph.dispatchEvent?.mock.calls.map(([event]) => event.type);
    expect(dispatchedTypes).toEqual([
      "pointermove",
      "mousemove",
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "pointermove",
      "click"
    ]);
    expect(doc.dispatchEvent.mock.calls.map(([event]) => event.type)).toContain("click");
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: 'Clicked <p> "Hello world"'
    });
  });

  it("collect_elements returns structured fields without executing arbitrary script", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "collect_elements",
          arguments: {
            selector: ".question-type-item",
            fields: ["text", "className", "attributes", "rect", "visible"],
            limit: 10
          }
        }
      },
      {},
      sendResponse
    );

    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: expect.stringContaining("\"count\": 1")
    });
    const payload = JSON.parse(sendResponse.mock.calls[0][0].data as string) as {
      items: Array<Record<string, unknown>>;
    };
    expect(payload.items[0]).toMatchObject({
      className: "question-type-item",
      text: "单选题 示例内容",
      visible: true
    });
    expect(payload.items[0].attributes).toMatchObject({
      "data-kind": "single"
    });
    expect(payload.items[0].rect).toMatchObject({
      left: 60,
      top: 80,
      width: 240,
      height: 48
    });
  });

  it("submit_nearby_form_action clicks the nearby send button for a reply textarea", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "submit_nearby_form_action",
          arguments: {
            selector: "textarea#reply_textarea",
            actionHint: "发送 回复"
          }
        }
      },
      {},
      sendResponse
    );

    const dispatchedTypes = sendButton.dispatchEvent?.mock.calls.map(([event]) => event.type);
    expect(dispatchedTypes).toEqual([
      "pointermove",
      "mousemove",
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "pointermove",
      "click"
    ]);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: expect.stringContaining("\"method\":\"nearby_click\"")
    });
  });

  it("inspect_visibility_detection reports page text and script keyword signals without eval scripts", () => {
    const doc = globalThis.document as unknown as {
      body: {
        innerText?: string;
        textContent?: string;
        getAttribute?: (name: string) => string | null;
      };
      visibilityState?: string;
      hidden?: boolean;
      querySelectorAll: ReturnType<typeof vi.fn>;
    };
    const win = globalThis.window as unknown as {
      onblur?: () => void;
      onfocus?: () => void;
      onpagehide?: () => void;
    };

    doc.body.innerText = "已切屏次数：7 还剩余3次切屏";
    doc.body.textContent = doc.body.innerText;
    doc.body.getAttribute = (name: string) => name === "onblur" ? "recordBlur()" : null;
    doc.visibilityState = "visible";
    doc.hidden = false;
    win.onblur = function recordBlur() {};
    doc.querySelectorAll.mockImplementation((selector: string) => {
      if (selector === "script") {
        return [
          {
            src: "",
            getAttribute: () => null,
            textContent: "document.addEventListener('visibilitychange', checkHidden)"
          },
          {
            src: "https://example.com/exam-monitor.js",
            getAttribute: () => "https://example.com/exam-monitor.js",
            textContent: ""
          }
        ];
      }
      return [];
    });

    const sendResponse = vi.fn();
    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "inspect_visibility_detection",
          arguments: {}
        }
      },
      {},
      sendResponse
    );

    const response = sendResponse.mock.calls[0]?.[0] as { ok: boolean; data: string };
    expect(response.ok).toBe(true);
    const report = JSON.parse(response.data) as {
      pageTextSignals: { matches: Array<{ keyword: string; snippet: string }> };
      scriptSignals: { matches: Array<{ matches: string[] }> };
      handlerProperties: { windowOnblur: string | null; bodyOnblurAttr: string | null };
    };
    expect(report.pageTextSignals.matches.some((match) => match.keyword === "切屏")).toBe(true);
    expect(report.scriptSignals.matches.some((match) => match.matches.includes("visibilitychange"))).toBe(true);
    expect(report.handlerProperties.windowOnblur).toContain("recordBlur");
    expect(report.handlerProperties.bodyOnblurAttr).toBe("recordBlur()");
  });

  it("inspect_canvas_pixel reads RGBA data using buffer-scaled coordinates", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "inspect_canvas_pixel",
          arguments: {
            selector: "canvas.board",
            x: 120,
            y: 80
          }
        }
      },
      {},
      sendResponse
    );

    expect(canvas.getContext).toHaveBeenCalledWith("2d");
    const context = canvas.getContext.mock.results[0]?.value as {
      getImageData: ReturnType<typeof vi.fn>;
    };
    expect(context.getImageData).toHaveBeenCalledWith(240, 160, 1, 1);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: JSON.stringify({
        selector: "canvas.board",
        index: 0,
        coordinateMode: "css",
        cssPoint: {
          x: 120,
          y: 80
        },
        canvasPixel: {
          x: 240,
          y: 160
        },
        rgba: { r: 12, g: 34, b: 56, a: 255 },
        hex: "#0c2238ff"
      })
    });
  });

  it("streams translation by replacing paragraph text", async () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: true,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: true,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(650);

    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(insertedHosts).toHaveLength(0);
    expect(paragraph.insertAdjacentElement).not.toHaveBeenCalled();
    expect(paragraph.textContent).toBe("你好世界");
  });

  it("translate_current_page agent tool starts one-off page translation", async () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "translate_current_page",
          arguments: {}
        }
      },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(650);
    await Promise.resolve();
    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Started translating the current page."
    });
    expect(paragraph.textContent).toBe("你好世界");
  });

  it("does not keep auto page translation enabled after one-off page translation", async () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: false,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      vi.fn()
    );

    registeredHandler?.(
      {
        type: "TRANSLATE_CURRENT_PAGE_ONCE",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: false,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(650);
    await Promise.resolve();
    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: {
        skipped: false,
        count: 0
      }
    });
    expect(paragraph.textContent).toBe("你好世界");
    expect(mutationObservers.at(-1)?.disconnect).toHaveBeenCalled();
  });

  it("streams translation below the original without repeating source text", async () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: true,
          translationTargetLanguage: "中文",
          translationDisplayMode: "bilingual",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: true,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(20);

    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(insertedHosts).toHaveLength(1);
    expect(paragraph.insertAdjacentElement).toHaveBeenCalledWith("afterend", insertedHosts[0]);

    const host = insertedHosts[0];
    const body = host.__shadow?.children[1] as MockElement | undefined;
    expect(body?.textContent).toBe("你好世界");
    expect(body?.style.background).toBe("transparent");
    expect(body?.style.color).toBe("rgb(180, 180, 180)");
    expect(body?.style.fontWeight).toBe("700");
    expect(body?.style.fontSize).toBe("15px");
  });

  it("translates page paragraphs one by one instead of sending concurrent requests", async () => {
    const sendResponse = vi.fn();
    const secondParagraph: MockElement = {
      tagName: "P",
      id: "",
      className: "",
      innerText: "Second line",
      textContent: "Second line",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      getBoundingClientRect: () => ({ left: 20, top: 80, width: 320, height: 40, bottom: 120 }),
      closest: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn((_position: string, host: MockElement) => {
        insertedHosts.push(host);
        return host;
      })
    };

    const originalQuerySelectorAll = (globalThis as {
      document: { querySelectorAll: ReturnType<typeof vi.fn> };
    }).document.querySelectorAll;
    originalQuerySelectorAll.mockImplementation((selector: string) => {
      if (selector === "canvas.board" || selector === "canvas") {
        return [canvas];
      }
      if (selector === "p") {
        return [paragraph, secondParagraph];
      }
      if (selector === "div.ease.container") {
        return [container];
      }
      if (selector === "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, header") {
        return [paragraph, secondParagraph];
      }
      if (selector === "[data-neonagent-translation-source]") {
        const nodes: MockElement[] = [];
        if (paragraph.hasAttribute("data-neonagent-translation-source")) nodes.push(paragraph);
        if (secondParagraph.hasAttribute("data-neonagent-translation-source")) nodes.push(secondParagraph);
        return nodes;
      }
      return [];
    });

    const activeRequests: Array<{
      resolve: (message?: { type?: string; text?: string }) => void;
    }> = [];
    (globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect.mockImplementation(() => {
      const listeners: Array<(message: { type?: string; delta?: string; text?: string }) => void> = [];
      return {
        onMessage: {
          addListener: vi.fn((listener: (message: { type?: string; delta?: string; text?: string }) => void) => {
            listeners.push(listener);
          })
        },
        onDisconnect: {
          addListener: vi.fn()
        },
        postMessage: vi.fn(() => {
          activeRequests.push({
            resolve: (message = { type: "done", text: "译文" }) => {
              queueMicrotask(() => {
                listeners.forEach((listener) => listener(message));
              });
            }
          });
        }),
        disconnect: vi.fn()
      };
    });

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: true,
          selectionTranslationEnabled: false,
          translationTargetLanguage: "中文",
          translationDisplayMode: "bilingual",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 8
        }
      },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();

    expect(activeRequests).toHaveLength(1);

    activeRequests[0]?.resolve({ type: "done", text: "第一段译文" });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(activeRequests).toHaveLength(2);

    activeRequests[1]?.resolve({ type: "done", text: "第二段译文" });
    await Promise.resolve();
    await Promise.resolve();

    expect(insertedHosts).toHaveLength(2);
  });

  it("shows a retry icon while page paragraph translation is loading and ignores stale responses", async () => {
    const sendResponse = vi.fn();
    const findRetryButton = (node: MockElement | undefined): MockElement | undefined => {
      if (!node) return undefined;
      if (node.tagName === "BUTTON" && node.textContent === "↻") return node;
      for (const child of [...(node.children ?? [])].reverse()) {
        const found = findRetryButton(child);
        if (found) return found;
      }
      return undefined;
    };

    const activeRequests: Array<{
      resolve: (message?: { type?: string; text?: string; error?: string }) => void;
    }> = [];
    (globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect.mockImplementation(() => {
      const listeners: Array<(message: { type?: string; delta?: string; text?: string; error?: string }) => void> = [];
      return {
        onMessage: {
          addListener: vi.fn((listener: (message: { type?: string; delta?: string; text?: string; error?: string }) => void) => {
            listeners.push(listener);
          })
        },
        onDisconnect: {
          addListener: vi.fn()
        },
        postMessage: vi.fn(() => {
          activeRequests.push({
            resolve: (message = { type: "done", text: "译文" }) => {
              queueMicrotask(() => {
                listeners.forEach((listener) => listener(message));
              });
            }
          });
        }),
        disconnect: vi.fn()
      };
    });

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: true,
          selectionTranslationEnabled: false,
          translationTargetLanguage: "中文",
          translationDisplayMode: "bilingual",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 8
        }
      },
      {},
      sendResponse
    );

    const flush = async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };

    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();

    expect(activeRequests).toHaveLength(1);
    const firstBody = insertedHosts[0]?.__shadow?.children[1] as MockElement | undefined;
    expect(firstBody?.textContent).toBe("翻译中...↻");
    const retryButton = findRetryButton(firstBody);
    expect(retryButton?.getAttribute("aria-label")).toBe("重新开始翻译");

    retryButton?.click?.();
    await flush();

    expect(activeRequests).toHaveLength(2);
    activeRequests[0]?.resolve({ type: "done", text: "旧请求译文" });
    await flush();
    expect(firstBody?.textContent).toBe("翻译中...↻");

    activeRequests[1]?.resolve({ type: "done", text: "新请求译文" });
    await flush();
    expect(firstBody?.textContent).toBe("新请求译文");
  });

  it("retries failed page paragraph translations and continues with later paragraphs", async () => {
    const sendResponse = vi.fn();
    const findRetryButton = (node: MockElement | undefined): MockElement | undefined => {
      if (!node) return undefined;
      if (node.tagName === "BUTTON" && node.textContent === "↻") return node;
      for (const child of [...(node.children ?? [])].reverse()) {
        const found = findRetryButton(child);
        if (found) return found;
      }
      return undefined;
    };
    const secondParagraph: MockElement = {
      tagName: "P",
      id: "",
      className: "",
      innerText: "Second line",
      textContent: "Second line",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      getBoundingClientRect: () => ({ left: 20, top: 80, width: 320, height: 40, bottom: 120 }),
      closest: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn((_position: string, host: MockElement) => {
        insertedHosts.push(host);
        return host;
      })
    };

    const originalQuerySelectorAll = (globalThis as {
      document: { querySelectorAll: ReturnType<typeof vi.fn> };
    }).document.querySelectorAll;
    originalQuerySelectorAll.mockImplementation((selector: string) => {
      if (selector === "canvas.board" || selector === "canvas") {
        return [canvas];
      }
      if (selector === "p") {
        return [paragraph, secondParagraph];
      }
      if (selector === "div.ease.container") {
        return [container];
      }
      if (selector === "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, header") {
        return [paragraph, secondParagraph];
      }
      if (selector === "[data-neonagent-translation-source]") {
        const nodes: MockElement[] = [];
        if (paragraph.hasAttribute("data-neonagent-translation-source")) nodes.push(paragraph);
        if (secondParagraph.hasAttribute("data-neonagent-translation-source")) nodes.push(secondParagraph);
        return nodes;
      }
      return [];
    });

    const activeRequests: Array<{
      resolve: (message?: { type?: string; text?: string; error?: string }) => void;
    }> = [];
    (globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect.mockImplementation(() => {
      const listeners: Array<(message: { type?: string; delta?: string; text?: string; error?: string }) => void> = [];
      return {
        onMessage: {
          addListener: vi.fn((listener: (message: { type?: string; delta?: string; text?: string; error?: string }) => void) => {
            listeners.push(listener);
          })
        },
        onDisconnect: {
          addListener: vi.fn()
        },
        postMessage: vi.fn(() => {
          activeRequests.push({
            resolve: (message = { type: "done", text: "第二段译文" }) => {
              queueMicrotask(() => {
                listeners.forEach((listener) => listener(message));
              });
            }
          });
        }),
        disconnect: vi.fn()
      };
    });
    (globalThis as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.sendMessage.mockResolvedValue({
      ok: false,
      errors: ["network down"]
    });

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: true,
          selectionTranslationEnabled: false,
          translationTargetLanguage: "中文",
          translationDisplayMode: "bilingual",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 8
        }
      },
      {},
      sendResponse
    );

    const flush = async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };

    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();

    expect(activeRequests).toHaveLength(1);
    activeRequests[0]?.resolve({ type: "error", error: "stream failed" });
    await flush();
    expect(activeRequests).toHaveLength(2);
    activeRequests[1]?.resolve({ type: "error", error: "stream failed" });
    await flush();
    expect(activeRequests).toHaveLength(3);
    activeRequests[2]?.resolve({ type: "error", error: "stream failed" });
    await flush();

    const firstBody = insertedHosts[0]?.__shadow?.children[1] as MockElement | undefined;
    expect(firstBody?.textContent).toBe("翻译失败：network down↻");
    const retryButton = findRetryButton(firstBody);
    expect(retryButton?.textContent).toBe("↻");
    expect(retryButton?.getAttribute("aria-label")).toBe("重试翻译");
    expect(activeRequests).toHaveLength(4);

    activeRequests[3]?.resolve({ type: "done", text: "第二段译文" });
    await flush();

    const secondBody = insertedHosts[1]?.__shadow?.children[1] as MockElement | undefined;
    expect(secondBody?.textContent).toBe("第二段译文");

    retryButton?.click?.();
    await flush();

    expect(activeRequests).toHaveLength(5);
    activeRequests[4]?.resolve({ type: "done", text: "第一段重试译文" });
    await flush();

    expect(firstBody?.textContent).toBe("第一段重试译文");
  });

  it("skips translation candidates that contain media descendants", async () => {
    const sendResponse = vi.fn();
    const mediaParagraph: MockElement = {
      tagName: "P",
      id: "",
      className: "",
      innerText: "Photo story text",
      textContent: "Photo story text",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      getBoundingClientRect: () => ({ left: 20, top: 80, width: 320, height: 40, bottom: 120 }),
      closest: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelector: vi.fn((selector: string) => selector.includes("img") ? { tagName: "IMG" } : null),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn((_position: string, host: MockElement) => {
        insertedHosts.push(host);
        return host;
      })
    };

    const originalQuerySelectorAll = (globalThis as {
      document: { querySelectorAll: ReturnType<typeof vi.fn> };
    }).document.querySelectorAll;
    originalQuerySelectorAll.mockImplementation((selector: string) => {
      if (selector === "canvas.board" || selector === "canvas") {
        return [canvas];
      }
      if (selector === "p") {
        return [mediaParagraph, paragraph];
      }
      if (selector === "div.ease.container") {
        return [container];
      }
      if (selector === "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, header") {
        return [mediaParagraph, paragraph];
      }
      if (selector === "[data-neonagent-translation-source]") {
        const nodes: MockElement[] = [];
        if (mediaParagraph.hasAttribute("data-neonagent-translation-source")) nodes.push(mediaParagraph);
        if (paragraph.hasAttribute("data-neonagent-translation-source")) nodes.push(paragraph);
        return nodes;
      }
      return [];
    });

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: true,
          selectionTranslationEnabled: false,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 8
        }
      },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mediaParagraph.hasAttribute("data-neonagent-translation-source")).toBe(false);
    expect(mediaParagraph.insertAdjacentElement).not.toHaveBeenCalled();
    expect(mediaParagraph.textContent).toBe("Photo story text");
    expect(paragraph.hasAttribute("data-neonagent-translation-source")).toBe(true);
    expect(paragraph.textContent).toBe("你好世界");
  });

  it("skips translation candidates inside ad containers", async () => {
    const sendResponse = vi.fn();
    const adParagraph: MockElement = {
      tagName: "P",
      id: "",
      className: "",
      innerText: "Advertisement text",
      textContent: "Advertisement text",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      getBoundingClientRect: () => ({ left: 20, top: 80, width: 320, height: 40, bottom: 120 }),
      closest: vi.fn((selector: string) => selector.includes("google_ads_iframe") ? { tagName: "DIV" } : null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn((_position: string, host: MockElement) => {
        insertedHosts.push(host);
        return host;
      })
    };

    const originalQuerySelectorAll = (globalThis as {
      document: { querySelectorAll: ReturnType<typeof vi.fn> };
    }).document.querySelectorAll;
    originalQuerySelectorAll.mockImplementation((selector: string) => {
      if (selector === "canvas.board" || selector === "canvas") {
        return [canvas];
      }
      if (selector === "p") {
        return [adParagraph, paragraph];
      }
      if (selector === "div.ease.container") {
        return [container];
      }
      if (selector === "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, header") {
        return [adParagraph, paragraph];
      }
      if (selector === "[data-neonagent-translation-source]") {
        const nodes: MockElement[] = [];
        if (adParagraph.hasAttribute("data-neonagent-translation-source")) nodes.push(adParagraph);
        if (paragraph.hasAttribute("data-neonagent-translation-source")) nodes.push(paragraph);
        return nodes;
      }
      return [];
    });

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: true,
          selectionTranslationEnabled: false,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 8
        }
      },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(adParagraph.hasAttribute("data-neonagent-translation-source")).toBe(false);
    expect(adParagraph.insertAdjacentElement).not.toHaveBeenCalled();
    expect(adParagraph.textContent).toBe("Advertisement text");
    expect(paragraph.hasAttribute("data-neonagent-translation-source")).toBe(true);
    expect(paragraph.textContent).toBe("你好世界");
  });

  it("translates article header text while keeping navigation header text untouched", async () => {
    const sendResponse = vi.fn();
    const articleTitle: MockElement = {
      tagName: "H1",
      id: "",
      className: "",
      innerText: "Article headline",
      textContent: "Article headline",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      getBoundingClientRect: () => ({ left: 20, top: 80, width: 320, height: 40, bottom: 120 }),
      closest: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn((_position: string, host: MockElement) => {
        insertedHosts.push(host);
        return host;
      })
    };
    const navigationTitle: MockElement = {
      tagName: "H1",
      id: "",
      className: "",
      innerText: "Site navigation",
      textContent: "Site navigation",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      getBoundingClientRect: () => ({ left: 20, top: 20, width: 320, height: 40, bottom: 60 }),
      closest: vi.fn((selector: string) => selector.includes("nav") ? { tagName: "NAV" } : null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn((_position: string, host: MockElement) => {
        insertedHosts.push(host);
        return host;
      })
    };

    const originalQuerySelectorAll = (globalThis as {
      document: { querySelectorAll: ReturnType<typeof vi.fn> };
    }).document.querySelectorAll;
    originalQuerySelectorAll.mockImplementation((selector: string) => {
      if (selector === "canvas.board" || selector === "canvas") {
        return [canvas];
      }
      if (selector === "p") {
        return [];
      }
      if (selector === "div.ease.container") {
        return [container];
      }
      if (selector === "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, header") {
        return [navigationTitle, articleTitle];
      }
      if (selector === "[data-neonagent-translation-source]") {
        const nodes: MockElement[] = [];
        if (navigationTitle.hasAttribute("data-neonagent-translation-source")) nodes.push(navigationTitle);
        if (articleTitle.hasAttribute("data-neonagent-translation-source")) nodes.push(articleTitle);
        return nodes;
      }
      return [];
    });

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: true,
          selectionTranslationEnabled: false,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 8
        }
      },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(navigationTitle.hasAttribute("data-neonagent-translation-source")).toBe(false);
    expect(navigationTitle.textContent).toBe("Site navigation");
    expect(articleTitle.hasAttribute("data-neonagent-translation-source")).toBe(true);
    expect(articleTitle.textContent).toBe("你好世界");
  });

  it("skips paragraphs that are already in the target language during page translation", async () => {
    const sendResponse = vi.fn();
    paragraph.innerText = "这是中文";
    paragraph.textContent = "这是中文";

    const secondParagraph: MockElement = {
      tagName: "P",
      id: "",
      className: "",
      innerText: "Second line",
      textContent: "Second line",
      style: {},
      isConnected: true,
      dataset: {},
      __attrs: new Map(),
      getBoundingClientRect: () => ({ left: 20, top: 80, width: 320, height: 40, bottom: 120 }),
      closest: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute(name: string, value: string) {
        this.__attrs.set(name, value);
      },
      getAttribute(name: string) {
        return this.__attrs.get(name) ?? null;
      },
      hasAttribute(name: string) {
        return this.__attrs.has(name);
      },
      removeAttribute(name: string) {
        this.__attrs.delete(name);
      },
      insertAdjacentElement: vi.fn((_position: string, host: MockElement) => {
        insertedHosts.push(host);
        return host;
      })
    };

    const originalQuerySelectorAll = (globalThis as {
      document: { querySelectorAll: ReturnType<typeof vi.fn> };
    }).document.querySelectorAll;
    originalQuerySelectorAll.mockImplementation((selector: string) => {
      if (selector === "canvas.board" || selector === "canvas") {
        return [canvas];
      }
      if (selector === "p") {
        return [paragraph, secondParagraph];
      }
      if (selector === "div.ease.container") {
        return [container];
      }
      if (selector === "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, header") {
        return [paragraph, secondParagraph];
      }
      if (selector === "[data-neonagent-translation-source]") {
        const nodes: MockElement[] = [];
        if (paragraph.hasAttribute("data-neonagent-translation-source")) nodes.push(paragraph);
        if (secondParagraph.hasAttribute("data-neonagent-translation-source")) nodes.push(secondParagraph);
        return nodes;
      }
      return [];
    });

    const activeRequests: Array<{
      resolve: (message?: { type?: string; text?: string }) => void;
    }> = [];
    (globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect.mockImplementation(() => {
      const listeners: Array<(message: { type?: string; delta?: string; text?: string }) => void> = [];
      return {
        onMessage: {
          addListener: vi.fn((listener: (message: { type?: string; delta?: string; text?: string }) => void) => {
            listeners.push(listener);
          })
        },
        onDisconnect: {
          addListener: vi.fn()
        },
        postMessage: vi.fn(() => {
          activeRequests.push({
            resolve: (message = { type: "done", text: "第二段译文" }) => {
              queueMicrotask(() => {
                listeners.forEach((listener) => listener(message));
              });
            }
          });
        }),
        disconnect: vi.fn()
      };
    });

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: true,
          selectionTranslationEnabled: false,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 8
        }
      },
      {},
      sendResponse
    );

    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();

    expect(activeRequests).toHaveLength(1);

    activeRequests[0]?.resolve({ type: "done", text: "第二段译文" });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(paragraph.textContent).toBe("这是中文");
    expect(secondParagraph.textContent).toBe("第二段译文");
  });

  it("enables double-click and selected-text translation without page translation", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: true,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    (globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect.mockClear();
    (globalThis as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.sendMessage.mockClear();

    const addEventListener = (globalThis as { document: { addEventListener: ReturnType<typeof vi.fn> } }).document.addEventListener;
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(addEventListener).toHaveBeenCalledWith("dblclick", expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith("mouseup", expect.any(Function), true);
    expect(addEventListener).toHaveBeenCalledWith("mousedown", expect.any(Function), true);
  });

  it("does not translate selected text when it is already in the target language", async () => {
    const sendResponse = vi.fn();
    const selection = {
      rangeCount: 1,
      toString: () => "这是中文",
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, top: 30, width: 80, height: 18, bottom: 48 })
      })
    };
    (globalThis as { window: { getSelection: ReturnType<typeof vi.fn> } }).window.getSelection.mockReturnValue(selection);

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: true,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    (globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect.mockClear();
    (globalThis as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.sendMessage.mockClear();

    const addEventListener = (globalThis as { document: { addEventListener: ReturnType<typeof vi.fn> } }).document.addEventListener;
    const mouseupListener = addEventListener.mock.calls.find((call) => call[0] === "mouseup")?.[1] as (event: MouseEvent) => void;
    mouseupListener(new MouseEvent("mouseup", { pageX: 30, pageY: 40 } as MouseEventInit));

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(insertedHosts).toHaveLength(0);
    expect((globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect)
      .not.toHaveBeenCalled();
    const sendMessageCalls = (globalThis as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.sendMessage.mock.calls;
    expect(sendMessageCalls.some(([message]) => message?.type === "TRANSLATE_SEGMENTS" || message?.type === "LOOKUP_WORD_DETAILS")).toBe(false);
  });

  it("does not double-click translate a word when it is already in the target language", async () => {
    const sendResponse = vi.fn();
    const selection = {
      rangeCount: 1,
      toString: () => "gateway",
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, top: 30, width: 80, height: 18, bottom: 48 })
      })
    };
    (globalThis as { window: { getSelection: ReturnType<typeof vi.fn> } }).window.getSelection.mockReturnValue(selection);

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: true,
          translationTargetLanguage: "English",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    const addEventListener = (globalThis as { document: { addEventListener: ReturnType<typeof vi.fn> } }).document.addEventListener;
    const dblclickListener = addEventListener.mock.calls.find((call) => call[0] === "dblclick")?.[1] as (event: MouseEvent) => void;
    dblclickListener(new MouseEvent("dblclick", { pageX: 30, pageY: 40 } as MouseEventInit));

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(insertedHosts).toHaveLength(0);
    expect((globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect)
      .not.toHaveBeenCalled();
    const sendMessageCalls = (globalThis as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.sendMessage.mock.calls;
    expect(sendMessageCalls.some(([message]) => message?.type === "TRANSLATE_SEGMENTS" || message?.type === "LOOKUP_WORD_DETAILS")).toBe(false);
  });

  it("updates selected-text translation popup with streamed content", async () => {
    const sendResponse = vi.fn();
    const selection = {
      rangeCount: 1,
      toString: () => "Hello",
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, top: 30, width: 80, height: 18, bottom: 48 })
      })
    };
    (globalThis as { window: { getSelection: ReturnType<typeof vi.fn> } }).window.getSelection.mockReturnValue(selection);

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: true,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    const addEventListener = (globalThis as { document: { addEventListener: ReturnType<typeof vi.fn> } }).document.addEventListener;
    const mouseupListener = addEventListener.mock.calls.find((call) => call[0] === "mouseup")?.[1] as (event: MouseEvent) => void;
    mouseupListener(new MouseEvent("mouseup", { pageX: 30, pageY: 40 } as MouseEventInit));

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const popup = insertedHosts.at(-1);
    expect(popup?.getAttribute("data-neonagent-selection-translation")).toBe("true");
    expect(popup?.textContent).toBe("你好世界");
    expect(popup?.style.width).toBe("max-content");
    expect(popup?.style.minWidth).toBe("0");
    expect(popup?.style.background).toBe("rgba(10, 12, 16, 0.42)");
    expect(popup?.style.border).toBe("0");
    expect(popup?.style.color).toBe("#f8fafc");
    expect(popup?.style.backdropFilter).toBe("blur(18px) saturate(1.35)");
  });

  it("shows pronunciation and part of speech when double-clicking a single word", async () => {
    const sendResponse = vi.fn();
    const selection = {
      rangeCount: 1,
      toString: () => "gateway",
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, top: 30, width: 80, height: 18, bottom: 48 })
      })
    };
    (globalThis as { window: { getSelection: ReturnType<typeof vi.fn> } }).window.getSelection.mockReturnValue(selection);
    (globalThis as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.sendMessage.mockResolvedValueOnce({
      ok: true,
      data: {
        translation: "网关",
        pronunciation: "/ˈɡeɪtweɪ/",
        partOfSpeech: "n."
      }
    });

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: true,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    const addEventListener = (globalThis as { document: { addEventListener: ReturnType<typeof vi.fn> } }).document.addEventListener;
    const dblclickListener = addEventListener.mock.calls.find((call) => call[0] === "dblclick")?.[1] as (event: MouseEvent) => void;
    dblclickListener(new MouseEvent("dblclick", { pageX: 30, pageY: 40 } as MouseEventInit));

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const popup = insertedHosts.at(-1);
    expect(popup?.getAttribute("data-neonagent-selection-translation")).toBe("true");
    expect(popup?.textContent).toContain("gateway");
    expect(popup?.textContent).toContain("/ˈɡeɪtweɪ/");
    expect(popup?.textContent).toContain("n.");
    expect(popup?.textContent).toContain("网关");
    expect(popup?.appendChild).toHaveBeenCalledTimes(2);
    expect((globalThis as { chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } } }).chrome.runtime.sendMessage)
      .toHaveBeenCalledWith({
        type: "LOOKUP_WORD_DETAILS",
        payload: {
          text: "gateway",
          targetLanguage: "中文"
        }
      });
  });

  it("shows only the final translation when model content includes reasoning text", async () => {
    const sendResponse = vi.fn();
    const reasoningOutput = [
      "The user wants me to translate a paragraph into Chinese. However, I notice that the user only provided \"gateway\" as the text to translate.",
      "Since the instruction says to translate the following paragraph but there's only one word gateway, I should translate this single word into Chinese.",
      "Given the context, 网关 is the most appropriate translation.",
      "Actually, looking at this more carefully - I should translate what was given.网关"
    ].join("\n");

    (globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect.mockImplementationOnce(() => {
      const listeners: Array<(message: { type?: string; delta?: string; text?: string }) => void> = [];
      return {
        onMessage: {
          addListener: vi.fn((listener: (message: { type?: string; delta?: string; text?: string }) => void) => {
            listeners.push(listener);
          })
        },
        onDisconnect: {
          addListener: vi.fn()
        },
        postMessage: vi.fn(() => {
          queueMicrotask(() => {
            listeners.forEach((listener) => listener({ type: "delta", delta: reasoningOutput }));
            listeners.forEach((listener) => listener({ type: "done", text: reasoningOutput }));
          });
        }),
        disconnect: vi.fn()
      };
    });

    const selection = {
      rangeCount: 1,
      toString: () => "gateway",
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, top: 30, width: 80, height: 18, bottom: 48 })
      })
    };
    (globalThis as { window: { getSelection: ReturnType<typeof vi.fn> } }).window.getSelection.mockReturnValue(selection);

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: true,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    const addEventListener = (globalThis as { document: { addEventListener: ReturnType<typeof vi.fn> } }).document.addEventListener;
    const mouseupListener = addEventListener.mock.calls.find((call) => call[0] === "mouseup")?.[1] as (event: MouseEvent) => void;
    mouseupListener(new MouseEvent("mouseup", { pageX: 30, pageY: 40 } as MouseEventInit));

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(insertedHosts.at(-1)?.textContent).toBe("网关");
  });

  it("does not show model no-content prompts as selected-text translation", async () => {
    const sendResponse = vi.fn();
    const noContentReply = "抱歉，您没有提供需要翻译的段落。请提供要翻译的内容。";

    (globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect.mockImplementationOnce(() => {
      const listeners: Array<(message: { type?: string; delta?: string; text?: string }) => void> = [];
      return {
        onMessage: {
          addListener: vi.fn((listener: (message: { type?: string; delta?: string; text?: string }) => void) => {
            listeners.push(listener);
          })
        },
        onDisconnect: {
          addListener: vi.fn()
        },
        postMessage: vi.fn(() => {
          queueMicrotask(() => {
            listeners.forEach((listener) => listener({ type: "done", text: noContentReply }));
          });
        }),
        disconnect: vi.fn()
      };
    });

    const selection = {
      rangeCount: 1,
      toString: () => "gateway",
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, top: 30, width: 80, height: 18, bottom: 48 })
      })
    };
    (globalThis as { window: { getSelection: ReturnType<typeof vi.fn> } }).window.getSelection.mockReturnValue(selection);

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: true,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    const addEventListener = (globalThis as { document: { addEventListener: ReturnType<typeof vi.fn> } }).document.addEventListener;
    const mouseupListener = addEventListener.mock.calls.find((call) => call[0] === "mouseup")?.[1] as (event: MouseEvent) => void;
    mouseupListener(new MouseEvent("mouseup", { pageX: 30, pageY: 40 } as MouseEventInit));

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const popup = insertedHosts.at(-1);
    expect(popup?.textContent).toBe("翻译中...");
    expect(popup?.remove).toHaveBeenCalled();
  });

  it("shows a friendly message when extension runtime is unavailable for selected-text translation", async () => {
    const sendResponse = vi.fn();
    const selection = {
      rangeCount: 1,
      toString: () => "gateway",
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, top: 30, width: 80, height: 18, bottom: 48 })
      })
    };
    (globalThis as { window: { getSelection: ReturnType<typeof vi.fn> } }).window.getSelection.mockReturnValue(selection);
    (globalThis as { chrome: { runtime?: unknown } }).chrome.runtime = undefined;

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: true,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    const addEventListener = (globalThis as { document: { addEventListener: ReturnType<typeof vi.fn> } }).document.addEventListener;
    const mouseupListener = addEventListener.mock.calls.find((call) => call[0] === "mouseup")?.[1] as (event: MouseEvent) => void;
    mouseupListener(new MouseEvent("mouseup", { pageX: 30, pageY: 40 } as MouseEventInit));

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(insertedHosts.at(-1)?.textContent).toBe("翻译失败：扩展运行时不可用，请刷新页面后重试");
  });

  it("silently stops selected-text translation when extension context is invalidated", async () => {
    const sendResponse = vi.fn();
    const selection = {
      rangeCount: 1,
      toString: () => "gateway",
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 20, top: 30, width: 80, height: 18, bottom: 48 })
      })
    };
    (globalThis as { window: { getSelection: ReturnType<typeof vi.fn> } }).window.getSelection.mockReturnValue(selection);
    (globalThis as { chrome: { runtime: { connect: ReturnType<typeof vi.fn> } } }).chrome.runtime.connect.mockImplementationOnce(() => {
      throw new Error("Extension context invalidated.");
    });

    registeredHandler?.(
      {
        type: "APPLY_TRANSLATION_SETTINGS",
        payload: {
          translationEnabled: false,
          selectionTranslationEnabled: true,
          translationTargetLanguage: "中文",
          translationDisplayMode: "replace",
          translationStyleColor: "#111827",
          translationStyleBackground: "#f8fafc",
          translationStyleFontSize: 15,
          translationStyleBold: false,
          translationStyleItalic: false,
          translationDebounceMs: 10,
          translationBatchSize: 2
        }
      },
      {},
      sendResponse
    );

    const documentMock = (globalThis as {
      document: {
        addEventListener: ReturnType<typeof vi.fn>;
        removeEventListener: ReturnType<typeof vi.fn>;
      };
    }).document;
    const mouseupListener = documentMock.addEventListener.mock.calls.find((call) => call[0] === "mouseup")?.[1] as (event: MouseEvent) => void;
    mouseupListener(new MouseEvent("mouseup", { pageX: 30, pageY: 40 } as MouseEventInit));

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const popup = insertedHosts.at(-1);
    expect(popup?.textContent).toBe("翻译中...");
    expect(popup?.remove).toHaveBeenCalled();
    expect(documentMock.removeEventListener).toHaveBeenCalledWith("mouseup", expect.any(Function), true);
  });

  it("write_translation_to_page injects a manual translation block near the target node", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "write_translation_to_page",
          arguments: {
            selector: "p",
            text: "手动译文",
            displayMode: "below"
          }
        }
      },
      {},
      sendResponse
    );

    const host = insertedHosts.at(-1);
    const body = host?.__shadow?.children[1] as MockElement | undefined;
    expect(body?.textContent).toBe("手动译文");
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Wrote translation near p[0] using below mode"
    });
  });

  it("write_translation_to_page inserts into container targets instead of after the whole container", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "write_translation_to_page",
          arguments: {
            selector: "div.ease.container",
            text: "容器内译文",
            displayMode: "below"
          }
        }
      },
      {},
      sendResponse
    );

    expect(container.insertAdjacentElement).toHaveBeenCalled();
    expect(container.insertAdjacentElement.mock.calls[0]?.[0]).toBe("beforeend");
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Wrote translation near div.ease.container[0] using below mode"
    });
  });

  it("write_translation_to_page respects explicit position parameter", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "write_translation_to_page",
          arguments: {
            selector: "div.ease.container",
            text: "强制向前插入",
            position: "afterbegin"
          }
        }
      },
      {},
      sendResponse
    );

    expect(container.insertAdjacentElement).toHaveBeenCalled();
    expect(container.insertAdjacentElement.mock.calls.at(-1)?.[0]).toBe("afterbegin");
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Wrote translation near div.ease.container[0] using below mode"
    });
  });

  it("remove_translation_from_page removes inserted translation blocks", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "write_translation_to_page",
          arguments: {
            selector: "p",
            text: "待删除译文"
          }
        }
      },
      {},
      vi.fn()
    );

    const host = insertedHosts.at(-1);
    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "remove_translation_from_page",
          arguments: {
            selector: "p"
          }
        }
      },
      {},
      sendResponse
    );

    expect(host?.remove).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Removed translation for p[0]"
    });
  });

  it("update_translation_on_page updates an existing translation block in place", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "write_translation_to_page",
          arguments: {
            selector: "p",
            text: "旧译文"
          }
        }
      },
      {},
      vi.fn()
    );

    const host = insertedHosts.at(-1);
    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "update_translation_on_page",
          arguments: {
            selector: "p",
            text: "新译文",
            displayMode: "hover"
          }
        }
      },
      {},
      sendResponse
    );

    const body = host?.__shadow?.children[1] as MockElement | undefined;
    expect(insertedHosts).toHaveLength(1);
    expect(body?.textContent).toBe("新译文");
    expect(host?.style.display).toBe("none");
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Updated translation for p[0] in place"
    });
  });

  it("update_translation_on_page creates a translation block when none exists", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "update_translation_on_page",
          arguments: {
            selector: "p",
            text: "首次更新",
            displayMode: "below"
          }
        }
      },
      {},
      sendResponse
    );

    const host = insertedHosts.at(-1);
    const body = host?.__shadow?.children[1] as MockElement | undefined;
    expect(body?.textContent).toBe("首次更新");
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Created translation for p[0] using below mode"
    });
  });

  it("insert_text_block writes a plain text block next to the target element", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "insert_text_block",
          arguments: {
            selector: "p",
            text: "注释文本",
            position: "afterend"
          }
        }
      },
      {},
      sendResponse
    );

    const host = insertedHosts.at(-1);
    expect(host?.textContent).toBe("注释文本");
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Inserted text block afterend of p[0]"
    });
  });

  it("click_canvas_cell maps chess-style coordinates onto the canvas grid", () => {
    const sendResponse = vi.fn();

    registeredHandler?.(
      {
        type: "AGENT_TOOL_EXECUTE",
        payload: {
          toolName: "click_canvas_cell",
          arguments: {
            selector: "canvas.board",
            cell: "B2"
          }
        }
      },
      {},
      sendResponse
    );

    const clickEvent = canvas.dispatchEvent.mock.calls.at(-1)?.[0] as { clientX: number; clientY: number };
    expect(clickEvent.clientX).toBe(85);
    expect(clickEvent.clientY).toBe(345);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: "Clicked canvas cell row=1, col=1 on canvas.board[0] at (75.0, 325.0)"
    });
  });
});
