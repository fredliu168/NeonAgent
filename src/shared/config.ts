import type { LLMConfig, ValidationResult } from "./types.js";

/** Ensure a loaded config has the `models` array, migrating from old single-model format */
export function migrateConfig(config: LLMConfig): LLMConfig {
  const incomingModels = Array.isArray(config.models) ? config.models : undefined;
  const incomingModel = typeof config.model === "string" ? config.model.trim() : "";
  const next: LLMConfig = {
    ...DEFAULT_CONFIG,
    ...config
  };

  if (!incomingModels || incomingModels.length === 0) {
    const model = incomingModel || DEFAULT_CONFIG.model;
    next.model = model;
    next.models = [model];
  }

  if (!next.models.includes(next.model)) {
    next.model = next.models[0];
  }

  if (!next.translationTargetLanguage.trim()) {
    next.translationTargetLanguage = DEFAULT_CONFIG.translationTargetLanguage;
  }

  if (next.translationDisplayMode !== "below" && next.translationDisplayMode !== "hover") {
    next.translationDisplayMode = DEFAULT_CONFIG.translationDisplayMode;
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
  translationTargetLanguage: "中文",
  translationDisplayMode: "below",
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
  enableFloatingBall: false
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

  if (!input.translationTargetLanguage.trim()) {
    errors.push("translationTargetLanguage is required");
  }

  if (input.translationDisplayMode !== "below" && input.translationDisplayMode !== "hover") {
    errors.push("translationDisplayMode must be 'below' or 'hover'");
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

  if (typeof input.enableFloatingBall !== "boolean") {
    errors.push("enableFloatingBall must be boolean");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}