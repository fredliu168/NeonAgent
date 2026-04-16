import type { LLMConfig, ValidationResult } from "./types.js";

export const DEFAULT_CONFIG: LLMConfig = {
  baseUrl: "",
  apiKey: "",
  model: "gpt-4o-mini",
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