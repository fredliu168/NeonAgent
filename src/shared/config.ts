import type { ApiProvider, LLMConfig, ValidationResult } from "./types.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const CONTROL_CHARS = /^[\s\u0000-\u001F\u007F]+|[\s\u0000-\u001F\u007F]+$/g;
export const MAX_AGENT_OUTPUT_TOKENS = 65536;

interface ApiProviderMeta {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  defaultModels: string[];
}

const BUILT_IN_API_PROVIDER_META: ApiProviderMeta[] = [
  {
    id: "kimi",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
    defaultModels: ["kimi-k2.5", "kimi-k2-thinking", "moonshot-v1-128k", "moonshot-v1-32k", "moonshot-v1-8k"]
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    defaultModel: "MiniMax-M3",
    defaultModels: ["MiniMax-M3", "MiniMax-M2.7"]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    defaultModels: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"]
  },
  {
    id: "volcengine",
    name: "火山引擎",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    defaultModel: "doubao-seed-2-0-lite-260215",
    defaultModels: ["doubao-seed-2-0-lite-260215", "doubao-seed-1-6-251015"]
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Pro/zai-org/GLM-4.7",
    defaultModels: ["Pro/zai-org/GLM-4.7", "deepseek-ai/DeepSeek-V3.2", "Qwen/Qwen3-32B", "Qwen/QwQ-32B"]
  }
];

function sanitizeText(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

function sanitizeModel(model: string, fallback = DEFAULT_MODEL): string {
  const cleaned = sanitizeText(model);
  return cleaned || fallback;
}

function normalizeModelList(models: unknown, fallbackModel: string): string[] {
  const sanitize = (value: string) => sanitizeText(value);

  if (!Array.isArray(models)) {
    return [fallbackModel];
  }

  const unique: string[] = [];
  for (const model of models) {
    if (typeof model !== "string") {
      continue;
    }
    const cleaned = sanitize(model);
    if (!cleaned) {
      continue;
    }
    if (!unique.includes(cleaned)) {
      unique.push(cleaned);
    }
  }

  if (unique.length === 0) {
    unique.push(fallbackModel);
  }

  if (!unique.includes(fallbackModel)) {
    unique.unshift(fallbackModel);
  }

  return unique;
}

function createProvider(meta: ApiProviderMeta, fallback: Partial<Pick<ApiProvider, "apiKey">> = {}, builtIn = false): ApiProvider {
  const model = sanitizeModel(meta.defaultModel, meta.defaultModel);
  const models = normalizeModelList(meta.defaultModels, model);
  return {
    id: meta.id,
    name: meta.name,
    baseUrl: normalizeBaseUrl(meta.baseUrl),
    apiKey: sanitizeText(typeof fallback.apiKey === "string" ? fallback.apiKey : ""),
    model,
    translationModel: "",
    models,
    builtIn
  };
}

function createCustomProvider(fallback: Partial<Pick<LLMConfig, "baseUrl" | "apiKey" | "model" | "translationModel" | "models">> = {}): ApiProvider {
  const model = sanitizeModel(typeof fallback.model === "string" ? fallback.model : DEFAULT_MODEL);
  const models = normalizeModelList(fallback.models, model);
  const translationModel = typeof fallback.translationModel === "string" ? sanitizeText(fallback.translationModel) : "";
  if (translationModel && !models.includes(translationModel)) {
    models.push(translationModel);
  }
  return {
    id: CUSTOM_API_PROVIDER_ID,
    name: "自定义",
    baseUrl: normalizeBaseUrl(typeof fallback.baseUrl === "string" ? fallback.baseUrl : ""),
    apiKey: sanitizeText(typeof fallback.apiKey === "string" ? fallback.apiKey : ""),
    model,
    translationModel,
    models,
    builtIn: false
  };
}

function cloneProvider(provider: ApiProvider): ApiProvider {
  return {
    ...provider,
    models: [...provider.models]
  };
}

export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname === "" || pathname === "/") {
      parsed.pathname = "/v1/chat/completions";
      return parsed.toString();
    }
    if (pathname === "/v1") {
      parsed.pathname = "/v1/chat/completions";
      return parsed.toString();
    }
    if (pathname.endsWith("/chat/completions")) {
      return parsed.toString();
    }
  } catch {
    // Not a valid full URL — return as-is for validation to catch
  }
  return trimmed;
}

export const BUILT_IN_API_PROVIDERS: ApiProvider[] = BUILT_IN_API_PROVIDER_META.map((meta) =>
  createProvider(meta, { apiKey: "" }, true)
);

export const CUSTOM_API_PROVIDER_ID = "custom";

export function createDefaultApiProviders(fallback: Partial<Pick<LLMConfig, "baseUrl" | "apiKey" | "model" | "translationModel" | "models">> = {}): ApiProvider[] {
  const normalizedBaseUrl = normalizeBaseUrl(typeof fallback.baseUrl === "string" ? fallback.baseUrl : "");
  const model = sanitizeModel(typeof fallback.model === "string" ? fallback.model : DEFAULT_MODEL);
  const models = normalizeModelList(fallback.models, model);
  const apiKey = sanitizeText(typeof fallback.apiKey === "string" ? fallback.apiKey : "");
  const translationModel = typeof fallback.translationModel === "string" ? sanitizeText(fallback.translationModel) : "";
  const matchesBuiltIn = BUILT_IN_API_PROVIDER_META.some(
    (provider) => normalizeBaseUrl(provider.baseUrl) === normalizedBaseUrl
  );

  return [
    ...BUILT_IN_API_PROVIDER_META.map((meta) =>
    createProvider(meta, { apiKey }, true)
  ),
    {
      id: CUSTOM_API_PROVIDER_ID,
      name: "自定义",
      baseUrl: matchesBuiltIn ? "" : normalizedBaseUrl,
      apiKey,
      model,
      translationModel,
      models: translationModel && !models.includes(translationModel)
        ? [...models, translationModel]
        : [...models],
      builtIn: false
    }
  ];
}

function sanitizeProviderId(id: string): string {
  return sanitizeText(id) || CUSTOM_API_PROVIDER_ID;
}

function sanitizeProviderName(name: string, fallbackId: string): string {
  return sanitizeText(name) || fallbackId;
}

function sanitizeApiProvider(provider: Partial<ApiProvider>, fallbackId: string, fallback: Partial<Pick<LLMConfig, "apiKey" | "model" | "models">> = {}): ApiProvider | null {
  const id = sanitizeProviderId(typeof provider.id === "string" ? provider.id : fallbackId);
  const name = sanitizeProviderName(typeof provider.name === "string" ? provider.name : "", id);
  const baseUrl = normalizeBaseUrl(typeof provider.baseUrl === "string" ? provider.baseUrl : "");
  const apiKey = sanitizeText(typeof provider.apiKey === "string" ? provider.apiKey : (typeof fallback.apiKey === "string" ? fallback.apiKey : ""));
  const model = sanitizeModel(
    typeof provider.model === "string" ? provider.model : (typeof fallback.model === "string" ? fallback.model : DEFAULT_MODEL),
    typeof fallback.model === "string" ? fallback.model : DEFAULT_MODEL
  );
  const models = normalizeModelList(
    provider.models ?? fallback.models,
    model
  );
  const translationModel = typeof provider.translationModel === "string"
    ? sanitizeText(provider.translationModel)
    : "";
  if (translationModel && !models.includes(translationModel)) {
    models.push(translationModel);
  }

  if (!id) {
    return null;
  }

  return {
    id,
    name,
    baseUrl,
    apiKey,
    model,
    translationModel,
    models,
    builtIn: provider.builtIn === true
  };
}

function mergeApiProviders(incomingProviders: unknown, fallback: Partial<Pick<LLMConfig, "baseUrl" | "apiKey" | "model" | "translationModel" | "models">> = {}): ApiProvider[] {
  const list = Array.isArray(incomingProviders) ? incomingProviders : [];
  const incomingById = new Map<string, ApiProvider>();
  const customProviders = new Map<string, ApiProvider>();
  const fallbackBuiltIn = {
    apiKey: typeof fallback.apiKey === "string" ? fallback.apiKey : "",
    model: typeof fallback.model === "string" ? fallback.model : DEFAULT_MODEL,
    models: Array.isArray(fallback.models) && fallback.models.length > 0 ? fallback.models : [typeof fallback.model === "string" ? sanitizeModel(fallback.model) : DEFAULT_MODEL]
  };
  const fallbackCustom = {
    apiKey: fallbackBuiltIn.apiKey,
    model: fallbackBuiltIn.model,
    translationModel: typeof fallback.translationModel === "string" ? sanitizeText(fallback.translationModel) : "",
    models: fallbackBuiltIn.models
  };

  list.forEach((provider, index) => {
    const sanitized = sanitizeApiProvider(provider as Partial<ApiProvider>, `provider-${index + 1}`, fallbackBuiltIn);
    if (!sanitized) {
      return;
    }

    if (BUILT_IN_API_PROVIDER_META.some((meta) => meta.id === sanitized.id)) {
      incomingById.set(sanitized.id, sanitized);
      return;
    }

    if (sanitized.id === CUSTOM_API_PROVIDER_ID) {
      incomingById.set(sanitized.id, sanitized);
      return;
    }

    customProviders.set(sanitized.id, sanitized);
  });

  const nextProviders = BUILT_IN_API_PROVIDER_META.map((meta) => {
    const incoming = incomingById.get(meta.id);
    if (incoming) {
      incoming.builtIn = true;
      incoming.baseUrl = normalizeBaseUrl(meta.baseUrl);
      return incoming;
    }
    return createProvider(meta, fallbackBuiltIn, true);
  });

  for (const provider of customProviders.values()) {
    nextProviders.push({ ...provider, builtIn: false });
  }

  const customProvider = incomingById.get(CUSTOM_API_PROVIDER_ID) ?? createCustomProvider({
    baseUrl: typeof fallback.baseUrl === "string" ? fallback.baseUrl : "",
    ...fallbackCustom
  });
  customProvider.builtIn = false;
  if (!nextProviders.some((provider) => provider.id === CUSTOM_API_PROVIDER_ID)) {
    nextProviders.push(customProvider);
  }

  return nextProviders.map(cloneProvider);
}

function findProviderByBaseUrl(providers: ApiProvider[], baseUrl: string): ApiProvider | undefined {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return undefined;
  return providers.find((provider) => normalizeBaseUrl(provider.baseUrl) === normalized);
}

function findBuiltInProviderByBaseUrl(providers: ApiProvider[], baseUrl: string): ApiProvider | undefined {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return undefined;
  return providers.find((provider) => provider.builtIn === true && normalizeBaseUrl(provider.baseUrl) === normalized);
}

function sanitizeConfigModels(config: Pick<LLMConfig, "model"> & { models?: string[] }): { model: string; models: string[] } {
  const incomingModels = Array.isArray(config.models) ? config.models : undefined;
  const incomingModel = typeof config.model === "string" ? config.model.trim() : "";

  if (!incomingModels || incomingModels.length === 0) {
    const model = sanitizeModel(incomingModel, DEFAULT_MODEL);
    return { model, models: [model] };
  }

  const models = incomingModels.map((model) => sanitizeText(model)).filter(Boolean);
  if (models.length === 0) {
    const model = sanitizeModel(incomingModel, DEFAULT_MODEL);
    return { model, models: [model] };
  }

  const model = models.includes(sanitizeText(incomingModel))
    ? sanitizeModel(incomingModel, models[0])
    : models[0];
  return { model, models };
}

function sanitizeOptionalModel(model: string | undefined): string {
  return typeof model === "string" ? sanitizeText(model) : "";
}

export function clampAgentMaxTokens(value: unknown): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10)
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_CONFIG.agentMaxTokens;
  }
  return Math.min(Math.floor(numeric), MAX_AGENT_OUTPUT_TOKENS);
}

function isWebSocketUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:";
  } catch {
    return false;
  }
}

/** Ensure a loaded config has the `models` array, migrating from old single-model format */
export function migrateConfig(config: LLMConfig): LLMConfig {
  const incomingActiveProviderId = typeof config.activeApiProviderId === "string"
    ? sanitizeText(config.activeApiProviderId)
    : "";
  const next: LLMConfig = {
    ...DEFAULT_CONFIG,
    ...config
  };

  const modelState = sanitizeConfigModels({
    model: typeof config.model === "string" ? config.model : DEFAULT_CONFIG.model,
    models: Array.isArray(config.models) ? config.models : undefined
  });
  next.model = modelState.model;
  next.models = modelState.models;
  next.translationModel = sanitizeOptionalModel(config.translationModel);

  next.baseUrl = normalizeBaseUrl(next.baseUrl);

  const providers = mergeApiProviders(next.apiProviders, {
    baseUrl: next.baseUrl,
    apiKey: next.apiKey,
    model: next.model,
    translationModel: next.translationModel,
    models: next.models
  });

  const activeProvider = providers.find((provider) => provider.id === incomingActiveProviderId)
    ?? findBuiltInProviderByBaseUrl(providers, next.baseUrl)
    ?? findProviderByBaseUrl(providers, next.baseUrl)
    ?? providers.find((provider) => provider.id === CUSTOM_API_PROVIDER_ID)
    ?? providers[0];

  if (activeProvider) {
    if (activeProvider.id === CUSTOM_API_PROVIDER_ID) {
      activeProvider.baseUrl = normalizeBaseUrl(next.baseUrl || activeProvider.baseUrl);
      activeProvider.apiKey = sanitizeText(next.apiKey || activeProvider.apiKey);
      activeProvider.translationModel = sanitizeOptionalModel(next.translationModel || activeProvider.translationModel);
    } else {
      activeProvider.apiKey = sanitizeText(activeProvider.apiKey || next.apiKey);
      activeProvider.translationModel = sanitizeOptionalModel(activeProvider.translationModel || next.translationModel);
    }

    const providerModelState = sanitizeConfigModels(activeProvider.id === CUSTOM_API_PROVIDER_ID
      ? {
          model: next.model,
          models: next.models
        }
      : {
          model: activeProvider.model,
          models: activeProvider.models
        });
    activeProvider.model = providerModelState.model;
    activeProvider.models = providerModelState.models;

    next.activeApiProviderId = activeProvider.id;
    next.baseUrl = normalizeBaseUrl(activeProvider.baseUrl);
    next.apiKey = activeProvider.apiKey;
    next.model = activeProvider.model;
    next.translationModel = sanitizeOptionalModel(activeProvider.translationModel);
    next.models = [...activeProvider.models];
  }

  next.apiProviders = providers;

  // Migrate thinkingFormat: old stored "none" was the previous default before we understood
  // that APIs returning reasoning_content need it sent back as a field
  if (!next.thinkingFormat || next.thinkingFormat === "none") {
    next.thinkingFormat = "field";
  }

  next.agentMaxTokens = clampAgentMaxTokens(next.agentMaxTokens);

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

  if (typeof next.blockDevtoolsDetection !== "boolean") {
    next.blockDevtoolsDetection = DEFAULT_CONFIG.blockDevtoolsDetection;
  }

  if (typeof next.autoSolveCurrentPage !== "boolean") {
    next.autoSolveCurrentPage = DEFAULT_CONFIG.autoSolveCurrentPage;
  }

  if (typeof next.autoBlockXSpamAccounts !== "boolean") {
    next.autoBlockXSpamAccounts = DEFAULT_CONFIG.autoBlockXSpamAccounts;
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
  model: DEFAULT_MODEL,
  models: [DEFAULT_MODEL],
  temperature: 0.2,
  maxTokens: 1024,
  agentMaxTokens: 8192,
  systemPrompt: "You are a helpful assistant.",
  translationEnabled: false,
  selectionTranslationEnabled: false,
  translationModel: "",
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
  blockDevtoolsDetection: false,
  autoSolveCurrentPage: false,
  autoBlockXSpamAccounts: false,
  enableFloatingBall: false,
  localCommandEnabled: false,
  localCommandWsUrl: "ws://127.0.0.1:8787/neonagent",
  localCommandToken: "",
  apiProviders: createDefaultApiProviders(),
  activeApiProviderId: CUSTOM_API_PROVIDER_ID,
  thinkingFormat: "field",
  solveButtonUnlocked: false
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

  if (typeof input.translationModel !== "string") {
    errors.push("translationModel must be string");
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

  if (typeof input.blockDevtoolsDetection !== "boolean") {
    errors.push("blockDevtoolsDetection must be boolean");
  }

  if (typeof input.autoSolveCurrentPage !== "boolean") {
    errors.push("autoSolveCurrentPage must be boolean");
  }

  if (typeof input.autoBlockXSpamAccounts !== "boolean") {
    errors.push("autoBlockXSpamAccounts must be boolean");
  }

  if (typeof input.enableFloatingBall !== "boolean") {
    errors.push("enableFloatingBall must be boolean");
  }

  if (typeof input.localCommandEnabled !== "boolean") {
    errors.push("localCommandEnabled must be boolean");
  }

  if (typeof input.localCommandWsUrl !== "string" || !input.localCommandWsUrl.trim()) {
    errors.push("localCommandWsUrl is required");
  } else if (!isWebSocketUrl(input.localCommandWsUrl.trim())) {
    errors.push("localCommandWsUrl must use ws:// or wss://");
  }

  if (typeof input.localCommandToken !== "string") {
    errors.push("localCommandToken must be string");
  }

  if (input.thinkingFormat !== "none" && input.thinkingFormat !== "field" && input.thinkingFormat !== "blocks") {
    errors.push("thinkingFormat must be 'none', 'field', or 'blocks'");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
