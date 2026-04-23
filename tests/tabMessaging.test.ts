import { describe, expect, it, vi } from "vitest";
import {
  formatInjectionDiagnosisNotice,
  isMissingReceiverError,
  sendMessageToTabIfAvailable,
  sendMessageToTabWithEnsureDiagnosis,
  sendMessageToTabWithEnsure
} from "../src/sidepanel/tabMessaging";

describe("tab messaging", () => {
  it("detects missing receiver runtime error", () => {
    const error = new Error("Could not establish connection. Receiving end does not exist.");
    expect(isMissingReceiverError(error)).toBe(true);
  });

  it("returns null when tab has no receiving end", async () => {
    const sendMessage = vi
      .fn<(tabId: number, message: unknown) => Promise<{ ok: boolean }>>()
      .mockRejectedValue(
        new Error("Could not establish connection. Receiving end does not exist.")
      );

    const response = await sendMessageToTabIfAvailable({
      tabId: 1,
      message: { type: "GET_PAGE_CONTEXT" },
      sendMessage
    });

    expect(response).toBeNull();
  });

  it("rethrows non-connection errors", async () => {
    const sendMessage = vi
      .fn<(tabId: number, message: unknown) => Promise<{ ok: boolean }>>()
      .mockRejectedValue(new Error("Unexpected"));

    await expect(
      sendMessageToTabIfAvailable({
        tabId: 1,
        message: { type: "GET_PAGE_CONTEXT" },
        sendMessage
      })
    ).rejects.toThrow("Unexpected");
  });

  it("retries once after ensuring receiver and then succeeds", async () => {
    const sendMessage = vi
      .fn<(tabId: number, message: unknown) => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(
        new Error("Could not establish connection. Receiving end does not exist.")
      )
      .mockResolvedValueOnce({ ok: true });
    const ensureReceiver = vi.fn(async () => {});

    const response = await sendMessageToTabWithEnsure({
      tabId: 1,
      message: { type: "GET_PAGE_CONTEXT" },
      sendMessage,
      ensureReceiver
    });

    expect(ensureReceiver).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(response).toEqual({ ok: true });
  });

  it("returns null when receiver is still missing after ensure step", async () => {
    const sendMessage = vi
      .fn<(tabId: number, message: unknown) => Promise<{ ok: boolean }>>()
      .mockRejectedValue(
        new Error("Could not establish connection. Receiving end does not exist.")
      );
    const ensureReceiver = vi.fn(async () => {});

    const response = await sendMessageToTabWithEnsure({
      tabId: 1,
      message: { type: "GET_PAGE_CONTEXT" },
      sendMessage,
      ensureReceiver
    });

    expect(ensureReceiver).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(response).toBeNull();
  });

  it("diagnoses insufficient permission when ensure step reports permission error", async () => {
    const sendMessage = vi
      .fn<(tabId: number, message: unknown) => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(
        new Error("Could not establish connection. Receiving end does not exist.")
      );
    const ensureReceiver = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("Cannot access contents of the page. Extension manifest must request permission to access the respective host."));

    const result = await sendMessageToTabWithEnsureDiagnosis({
      tabId: 1,
      message: { type: "GET_PAGE_CONTEXT" },
      sendMessage,
      ensureReceiver
    });

    expect(result).toEqual({ response: null, diagnosis: "insufficient_permission" });
    expect(formatInjectionDiagnosisNotice("insufficient_permission")).toContain("权限不足");
  });

  it("diagnoses dynamic injection failure when ensure step throws non-permission error", async () => {
    const sendMessage = vi
      .fn<(tabId: number, message: unknown) => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(
        new Error("Could not establish connection. Receiving end does not exist.")
      );
    const ensureReceiver = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("executeScript failed"));

    const result = await sendMessageToTabWithEnsureDiagnosis({
      tabId: 1,
      message: { type: "GET_PAGE_CONTEXT" },
      sendMessage,
      ensureReceiver
    });

    expect(result).toEqual({ response: null, diagnosis: "dynamic_injection_failed" });
    expect(formatInjectionDiagnosisNotice("dynamic_injection_failed")).toContain("动态注入失败");
  });

  it("diagnoses page policy blocked when receiver is still missing after successful ensure", async () => {
    const sendMessage = vi
      .fn<(tabId: number, message: unknown) => Promise<{ ok: boolean }>>()
      .mockRejectedValue(
        new Error("Could not establish connection. Receiving end does not exist.")
      );
    const ensureReceiver = vi.fn(async () => {});

    const result = await sendMessageToTabWithEnsureDiagnosis({
      tabId: 1,
      message: { type: "GET_PAGE_CONTEXT" },
      sendMessage,
      ensureReceiver
    });

    expect(result).toEqual({ response: null, diagnosis: "page_policy_blocked" });
    expect(formatInjectionDiagnosisNotice("page_policy_blocked")).toContain("页面策略仍拦截");
  });
});
