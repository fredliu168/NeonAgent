import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, validateConfig, migrateConfig } from "../src/shared/config";

describe("validateConfig", () => {
  it("contains feature flags in default config", () => {
    expect(DEFAULT_CONFIG.unlockContextMenu).toBe(false);
    expect(DEFAULT_CONFIG.blockVisibilityDetection).toBe(false);
    expect(DEFAULT_CONFIG.aggressiveVisibilityBypass).toBe(false);
    expect(DEFAULT_CONFIG.enableFloatingBall).toBe(false);
  });

  it("accepts a valid config", () => {
    const result = validateConfig({
      ...DEFAULT_CONFIG,
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "test-key"
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an out-of-range temperature", () => {
    const result = validateConfig({
      ...DEFAULT_CONFIG,
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "test-key",
      temperature: 2.1
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("temperature must be between 0 and 2");
  });

  it("rejects missing required fields", () => {
    const result = validateConfig({
      ...DEFAULT_CONFIG,
      baseUrl: "",
      apiKey: "",
      model: ""
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("baseUrl is required");
    expect(result.errors).toContain("apiKey is required");
    expect(result.errors).toContain("model is required");
  });

  it("rejects non-boolean feature flags", () => {
    const invalidUnlock = validateConfig({
      ...DEFAULT_CONFIG,
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "test-key",
      unlockContextMenu: "yes" as unknown as boolean
    });

    expect(invalidUnlock.valid).toBe(false);
    expect(invalidUnlock.errors).toContain("unlockContextMenu must be boolean");

    const invalidAggressive = validateConfig({
      ...DEFAULT_CONFIG,
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "test-key",
      aggressiveVisibilityBypass: "yes" as unknown as boolean
    });

    expect(invalidAggressive.valid).toBe(false);
    expect(invalidAggressive.errors).toContain("aggressiveVisibilityBypass must be boolean");
  });

  it("rejects empty models array", () => {
    const result = validateConfig({
      ...DEFAULT_CONFIG,
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "test-key",
      models: []
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("models must be a non-empty array");
  });

  it("rejects models with empty strings", () => {
    const result = validateConfig({
      ...DEFAULT_CONFIG,
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "test-key",
      models: ["gpt-4", ""]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("each model in models must be a non-empty string");
  });

  it("accepts config with multiple models", () => {
    const result = validateConfig({
      ...DEFAULT_CONFIG,
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "test-key",
      model: "gpt-4",
      models: ["gpt-4", "gpt-4o-mini", "claude-3-opus"]
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("migrateConfig", () => {
  it("adds models array from model when missing", () => {
    const old = { ...DEFAULT_CONFIG, model: "gpt-4" } as any;
    delete old.models;
    const migrated = migrateConfig(old);
    expect(migrated.models).toEqual(["gpt-4"]);
    expect(migrated.model).toBe("gpt-4");
  });

  it("adds models array when empty", () => {
    const old = { ...DEFAULT_CONFIG, model: "gpt-4", models: [] };
    const migrated = migrateConfig(old);
    expect(migrated.models).toEqual(["gpt-4"]);
  });

  it("fixes model when not in models list", () => {
    const cfg = { ...DEFAULT_CONFIG, model: "unknown", models: ["gpt-4", "gpt-4o"] };
    const migrated = migrateConfig(cfg);
    expect(migrated.model).toBe("gpt-4");
  });

  it("returns config as-is when valid", () => {
    const cfg = { ...DEFAULT_CONFIG, model: "gpt-4", models: ["gpt-4", "gpt-4o"] };
    const migrated = migrateConfig(cfg);
    expect(migrated).toEqual(cfg);
  });
});