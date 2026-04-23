import { describe, expect, it, vi } from "vitest";
import { createLoadPageContextAction } from "../src/sidepanel/contextActions";
import { TabInjectionDiagnosticError } from "../src/sidepanel/tabMessaging";

describe("sidepanel page context integration", () => {
  it("shows clear injection notice when current page cannot receive content messages", async () => {
    const ui = {
      setContext: vi.fn<(text: string) => void>(),
      setInjectionNotice: vi.fn<(text: string | null) => void>()
    };

    const loadPageContext = createLoadPageContextAction(
      {
        getCurrentTabId: async () => 101,
        sendTabMessage: vi
          .fn<
            (tabId: number, message: unknown) => Promise<{ ok?: boolean; data?: unknown }>
          >()
          .mockRejectedValue(
            new Error("Could not establish connection. Receiving end does not exist.")
          )
      },
      ui
    );

    await loadPageContext();

    expect(ui.setContext).toHaveBeenCalledWith("Current page does not support content script");
    expect(ui.setInjectionNotice).toHaveBeenCalledWith(
      "当前页面不支持注入内容脚本（例如 chrome://、扩展页或受限页面）。"
    );
  });

  it("shows permission diagnosis notice when runtime reports insufficient permission", async () => {
    const ui = {
      setContext: vi.fn<(text: string) => void>(),
      setInjectionNotice: vi.fn<(text: string | null) => void>()
    };

    const loadPageContext = createLoadPageContextAction(
      {
        getCurrentTabId: async () => 101,
        sendTabMessage: vi
          .fn<
            (tabId: number, message: unknown) => Promise<{ ok?: boolean; data?: unknown }>
          >()
          .mockRejectedValue(new TabInjectionDiagnosticError("insufficient_permission"))
      },
      ui
    );

    await loadPageContext();

    expect(ui.setContext).toHaveBeenCalledWith(
      "Content script injection diagnosis: insufficient_permission"
    );
    expect(ui.setInjectionNotice).toHaveBeenCalledWith(
      "注入诊断：权限不足，当前站点未授权脚本访问，无法注入内容脚本。"
    );
  });
});
