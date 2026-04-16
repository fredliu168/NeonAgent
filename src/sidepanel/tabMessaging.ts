export function isMissingReceiverError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("Could not establish connection. Receiving end does not exist.");
}

export type InjectionDiagnosticReason =
  | "insufficient_permission"
  | "dynamic_injection_failed"
  | "page_policy_blocked";

export interface TabSendWithDiagnosis<T> {
  response: T | null;
  diagnosis: InjectionDiagnosticReason | null;
}

export class TabInjectionDiagnosticError extends Error {
  readonly reason: InjectionDiagnosticReason;

  constructor(reason: InjectionDiagnosticReason) {
    super(`Tab injection diagnostic: ${reason}`);
    this.name = "TabInjectionDiagnosticError";
    this.reason = reason;
  }
}

export function isTabInjectionDiagnosticError(error: unknown): error is TabInjectionDiagnosticError {
  return error instanceof TabInjectionDiagnosticError;
}

function isPermissionDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("cannot access contents of") ||
    message.includes("missing host permission") ||
    message.includes("host permission") ||
    message.includes("permission")
  );
}

export function formatInjectionDiagnosisNotice(reason: InjectionDiagnosticReason): string {
  if (reason === "insufficient_permission") {
    return "注入诊断：权限不足，当前站点未授权脚本访问，无法注入内容脚本。";
  }

  if (reason === "dynamic_injection_failed") {
    return "注入诊断：动态注入失败，脚本下发未成功，请刷新页面后重试。";
  }

  return "注入诊断：页面策略仍拦截内容脚本，当前页面功能将受限。";
}

export async function sendMessageToTabIfAvailable<T>(input: {
  tabId: number;
  message: unknown;
  sendMessage: (tabId: number, message: unknown) => Promise<T>;
}): Promise<T | null> {
  try {
    return await input.sendMessage(input.tabId, input.message);
  } catch (error) {
    if (isMissingReceiverError(error)) {
      return null;
    }

    throw error;
  }
}

export async function sendMessageToTabWithEnsure<T>(input: {
  tabId: number;
  message: unknown;
  sendMessage: (tabId: number, message: unknown) => Promise<T>;
  ensureReceiver: () => Promise<void>;
}): Promise<T | null> {
  const result = await sendMessageToTabWithEnsureDiagnosis(input);
  return result.response;
}

export async function sendMessageToTabWithEnsureDiagnosis<T>(input: {
  tabId: number;
  message: unknown;
  sendMessage: (tabId: number, message: unknown) => Promise<T>;
  ensureReceiver: () => Promise<void>;
}): Promise<TabSendWithDiagnosis<T>> {
  try {
    return { response: await input.sendMessage(input.tabId, input.message), diagnosis: null };
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }
  }

  try {
    await input.ensureReceiver();
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      return { response: null, diagnosis: "insufficient_permission" };
    }

    return { response: null, diagnosis: "dynamic_injection_failed" };
  }

  try {
    return { response: await input.sendMessage(input.tabId, input.message), diagnosis: null };
  } catch (error) {
    if (isMissingReceiverError(error)) {
      return { response: null, diagnosis: "page_policy_blocked" };
    }

    throw error;
  }
}
