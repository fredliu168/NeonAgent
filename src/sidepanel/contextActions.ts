import {
  formatInjectionDiagnosisNotice,
  isTabInjectionDiagnosticError,
  sendMessageToTabIfAvailable
} from "./tabMessaging.js";

export interface PageContextUI {
  setContext: (text: string) => void;
  setInjectionNotice: (text: string | null) => void;
}

export interface LoadPageContextDependencies {
  getCurrentTabId: () => Promise<number | undefined>;
  sendTabMessage: (
    tabId: number,
    message: unknown
  ) => Promise<{ ok?: boolean; data?: unknown }>;
}

export function createLoadPageContextAction(
  deps: LoadPageContextDependencies,
  ui: PageContextUI
): () => Promise<void> {
  return async () => {
    const tabId = await deps.getCurrentTabId();
    if (!tabId) {
      ui.setContext("No active tab");
      ui.setInjectionNotice("当前没有可用标签页，无法注入内容脚本。");
      return;
    }

    let response: { ok?: boolean; data?: unknown } | null;
    try {
      response = await sendMessageToTabIfAvailable<{ ok?: boolean; data?: unknown }>({
        tabId,
        message: { type: "GET_PAGE_CONTEXT" },
        sendMessage: deps.sendTabMessage
      });
    } catch (error) {
      if (isTabInjectionDiagnosticError(error)) {
        ui.setContext(`Content script injection diagnosis: ${error.reason}`);
        ui.setInjectionNotice(formatInjectionDiagnosisNotice(error.reason));
        return;
      }

      throw error;
    }

    if (!response) {
      ui.setContext("Current page does not support content script");
      ui.setInjectionNotice("当前页面不支持注入内容脚本（例如 chrome://、扩展页或受限页面）。");
      return;
    }

    if (!response.ok) {
      ui.setContext("Failed to load context");
      ui.setInjectionNotice("页面通信失败，请刷新页面后重试。");
      return;
    }

    ui.setContext(String(response.data ?? ""));
    ui.setInjectionNotice(null);
  };
}
