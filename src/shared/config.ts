import type { LLMConfig, ValidationResult } from "./types.js";

/** Ensure a loaded config has the `models` array, migrating from old single-model format */
export function migrateConfig(config: LLMConfig): LLMConfig {
  if (!Array.isArray(config.models) || config.models.length === 0) {
    const model = config.model?.trim() || DEFAULT_CONFIG.model;
    return { ...config, model, models: [model] };
  }
  if (!config.models.includes(config.model)) {
    return { ...config, model: config.models[0] };
  }
  return config;
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