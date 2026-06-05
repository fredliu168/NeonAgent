import type { LLMConfig, ValidationResult } from "./types.js";

/**
 * Normalize a baseUrl: if the user only entered a host/IP (path is "/" or empty),
 * automatically append "/v1/chat/completions".
 */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      return trimmed.replace(/\/$/, "") + "/v1/chat/completions";
    }
  } catch {
    // Not a valid full URL — return as-is for validation to catch
  }
  return trimmed;
}

/** Ensure a loaded config has the `models` array, migrating from old single-model format */
export function migrateConfig(config: LLMConfig): LLMConfig {
  const incomingModels = Array.isArray(config.models) ? config.models : undefined;
  const incomingModel = typeof config.model === "string" ? config.model.trim() : "";
  const next: LLMConfig = {
    ...DEFAULT_CONFIG,
    ...config
  };

  // Normalize models: strip surrounding whitespace and non-printable/special characters
  const sanitizeModel = (m: string) => m.replace(/^[\s\u0000-\u001F\u007F]+|[\s\u0000-\u001F\u007F]+$/g, "");

  if (!incomingModels || incomingModels.length === 0) {
    const model = sanitizeModel(incomingModel) || DEFAULT_CONFIG.model;
    next.model = model;
    next.models = [model];
  } else {
    next.models = incomingModels.map(sanitizeModel).filter(Boolean);
    if (next.models.length === 0) next.models = [DEFAULT_CONFIG.model];
  }

  next.model = sanitizeModel(next.model) || DEFAULT_CONFIG.model;

  if (!next.models.includes(next.model)) {
    next.model = next.models[0];
  }

  // Normalize baseUrl
  next.baseUrl = normalizeBaseUrl(next.baseUrl);

  // Migrate thinkingFormat: old stored "none" was the previous default before we understood
  // that APIs returning reasoning_content need it sent back as a field
  if (!next.thinkingFormat || next.thinkingFormat === "none") {
    next.thinkingFormat = "field";
  }

  if (!next.translationTargetLanguage.trim()) {
    next.translationTargetLanguage = DEFAULT_CONFIG.translationTargetLanguage;
  }

  if (typeof next.selectionTranslationEnabled !== "boolean") {
    next.selectionTranslationEnabled = DEFAULT_CONFIG.selectionTranslationEnabled;
  }

  if (next.translationDisplayMode === ("below" as unknown) || next.translationDisplayMode === ("hover" as unknown)) {
    next.translationDisplayMode = "bilingual";
  }

  if (next.translationDisplayMode !== "replace" && next.translationDisplayMode !== "bilingual") {
    next.translationDisplayMode = DEFAULT_CONFIG.translationDisplayMode;
  }

  if (typeof next.localCommandEnabled !== "boolean") {
    next.localCommandEnabled = DEFAULT_CONFIG.localCommandEnabled;
  }

  if (typeof next.blockFullscreenRequests !== "boolean") {
    next.blockFullscreenRequests = DEFAULT_CONFIG.blockFullscreenRequests;
  }

  if (typeof next.autoSolveCurrentPage !== "boolean") {
    next.autoSolveCurrentPage = DEFAULT_CONFIG.autoSolveCurrentPage;
  }

  if (!next.localCommandWsUrl.trim()) {
    next.localCommandWsUrl = DEFAULT_CONFIG.localCommandWsUrl;
  }

  if (typeof next.localCommandToken !== "string") {
    next.localCommandToken = DEFAULT_CONFIG.localCommandToken;
  }

  if (!Number.isFinite(next.translationStyleFontSize) || next.translationStyleFontSize <= 0) {
    next.translationStyleFontSize = DEFAULT_CONFIG.translationStyleFontSize;
  }

  if (!Number.isFinite(next.translationDebounceMs) || next.translationDebounceMs < 0) {
    next.translationDebounceMs = DEFAULT_CONFIG.translationDebounceMs;
  }

  if (!Number.isInteger(next.translationBatchSize) || next.translationBatchSize <= 0) {
    next.translationBatchSize = DEFAULT_CONFIG.translationBatchSize;
  }

  return next;
}

export const DEFAULT_CONFIG: LLMConfig = {
  baseUrl: "",
  apiKey: "",
  model: "gpt-4o-mini",
  models: ["gpt-4o-mini"],
  temperature: 0.2,
  maxTokens: 1024,
  agentMaxTokens: 102400,
  systemPrompt: "You are a helpful assistant.",
  translationEnabled: false,
  selectionTranslationEnabled: false,
  translationTargetLanguage: "中文",
  translationDisplayMode: "replace",
  translationStyleColor: "#0f172a",
  translationStyleBackground: "#f8fafc",
  translationStyleFontSize: 14,
  translationStyleBold: false,
  translationStyleItalic: false,
  translationDebounceMs: 600,
  translationBatchSize: 8,
  unlockContextMenu: false,
  blockVisibilityDetection: false,
  aggressiveVisibilityBypass: false,
  blockFullscreenRequests: false,
  autoSolveCurrentPage: false,
  enableFloatingBall: false,
  localCommandEnabled: false,
  localCommandWsUrl: "ws://127.0.0.1:8787/neonagent",
  localCommandToken: "",
  thinkingFormat: "field"
};

export function validateConfig(input: LLMConfig): ValidationResult {
  const errors: string[] = [];

  if (!input.baseUrl.trim()) {
    errors.push("baseUrl is required");
  }

  if (!input.apiKey.trim()) {
    errors.push("apiKey is required");
  }

  if (!input.model.trim()) {
    errors.push("model is required");
  }

  if (!Array.isArray(input.models) || input.models.length === 0) {
    errors.push("models must be a non-empty array");
  } else if (!input.models.every((m) => typeof m === "string" && m.trim())) {
    errors.push("each model in models must be a non-empty string");
  }

  if (input.temperature < 0 || input.temperature > 2) {
    errors.push("temperature must be between 0 and 2");
  }

  if (!Number.isInteger(input.maxTokens) || input.maxTokens <= 0) {
    errors.push("maxTokens must be a positive integer");
  }

  if (typeof input.translationEnabled !== "boolean") {
    errors.push("translationEnabled must be boolean");
  }

  if (typeof input.selectionTranslationEnabled !== "boolean") {
    errors.push("selectionTranslationEnabled must be boolean");
  }

  if (!input.translationTargetLanguage.trim()) {
    errors.push("translationTargetLanguage is required");
  }

  if (input.translationDisplayMode !== "replace" && input.translationDisplayMode !== "bilingual") {
    errors.push("translationDisplayMode must be 'replace' or 'bilingual'");
  }

  if (!input.translationStyleColor.trim()) {
    errors.push("translationStyleColor is required");
  }

  if (!input.translationStyleBackground.trim()) {
    errors.push("translationStyleBackground is required");
  }

  if (!Number.isFinite(input.translationStyleFontSize) || input.translationStyleFontSize <= 0) {
    errors.push("translationStyleFontSize must be a positive number");
  }

  if (typeof input.translationStyleBold !== "boolean") {
    errors.push("translationStyleBold must be boolean");
  }

  if (typeof input.translationStyleItalic !== "boolean") {
    errors.push("translationStyleItalic must be boolean");
  }

  if (!Number.isInteger(input.translationDebounceMs) || input.translationDebounceMs < 0) {
    errors.push("translationDebounceMs must be a non-negative integer");
  }

  if (!Number.isInteger(input.translationBatchSize) || input.translationBatchSize <= 0) {
    errors.push("translationBatchSize must be a positive integer");
  }

  if (typeof input.unlockContextMenu !== "boolean") {
    errors.push("unlockContextMenu must be boolean");
  }

  if (typeof input.blockVisibilityDetection !== "boolean") {
    errors.push("blockVisibilityDetection must be boolean");
  }

  if (typeof input.aggressiveVisibilityBypass !== "boolean") {
    errors.push("aggressiveVisibilityBypass must be boolean");
  }

  if (typeof input.blockFullscreenRequests !== "boolean") {
    errors.push("blockFullscreenRequests must be boolean");
  }

  if (typeof input.autoSolveCurrentPage !== "boolean") {
    errors.push("autoSolveCurrentPage must be boolean");
  }

  if (typeof input.enableFloatingBall !== "boolean") {
    errors.push("enableFloatingBall must be boolean");
  }

  if (typeof input.localCommandEnabled !== "boolean") {
    errors.push("localCommandEnabled must be boolean");
  }

  if (typeof input.localCommandWsUrl !== "string" || !input.localCommandWsUrl.trim()) {
    errors.push("localCommandWsUrl is required");
  } else {
    try {
      const parsed = new URL(input.localCommandWsUrl);
      if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
        errors.push("localCommandWsUrl must use ws:// or wss://");
      }
    } catch {
      errors.push("localCommandWsUrl must be a valid WebSocket URL");
    }
  }

  if (typeof input.localCommandToken !== "string") {
    errors.push("localCommandToken must be string");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
