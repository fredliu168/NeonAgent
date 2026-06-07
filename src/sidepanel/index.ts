import {
  CUSTOM_API_PROVIDER_ID,
  DEFAULT_CONFIG,
  createDefaultApiProviders,
  migrateConfig,
  normalizeBaseUrl,
  validateConfig
} from "../shared/config.js";
import {
  createLLMStreamCancelMessage,
  createLLMStreamRequestMessage
} from "../shared/messages.js";
import { skillToMarkdown, parseSkillMarkdown, skillsToMarkdown, parseSkillsMarkdown } from "../shared/agentSkills.js";
import { memoriesToMarkdown, parseMemoriesMarkdown } from "../shared/agentMemory.js";
import type { ChatSession, ExamQuestion, LLMConfig, RuntimeStreamEvent } from "../shared/types.js";
import type { AgentMessage, AgentProgressEvent, AgentSession } from "../shared/agentTypes.js";
import {
  createInitialChatState,
  reduceChatState,
  type ChatStateAction
} from "./chatState.js";
import { createLoadPageContextAction } from "./contextActions.js";
import {
  TabInjectionDiagnosticError,
  formatInjectionDiagnosisNotice,
  sendMessageToTabWithEnsureDiagnosis
} from "./tabMessaging.js";
import type { ApiProvider } from "../shared/types.js";

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el as T;
}

const baseUrlInput = byId<HTMLInputElement>("baseUrl");
const thinkingFormatInput = byId<HTMLSelectElement>("thinkingFormat");
const apiKeyInput = byId<HTMLInputElement>("apiKey");
const apiKeyVisibilityBtn = byId<HTMLButtonElement>("toggleApiKeyVisibility");
const modelInput = byId<HTMLSelectElement>("model");
const newModelInput = byId<HTMLInputElement>("newModel");
const addModelBtn = byId<HTMLButtonElement>("addModel");
const removeModelBtn = byId<HTMLButtonElement>("removeModel");
const agentMaxTokensInput = byId<HTMLInputElement>("agentMaxTokens");
const translationEnabledInput = byId<HTMLInputElement>("translationEnabled");
const selectionTranslationEnabledInput = byId<HTMLInputElement>("selectionTranslationEnabled");
const translationTargetLanguageInput = byId<HTMLInputElement>("translationTargetLanguage");
const translationDisplayModeInput = byId<HTMLSelectElement>("translationDisplayMode");
const translationDebounceMsInput = byId<HTMLInputElement>("translationDebounceMs");
const translationBatchSizeInput = byId<HTMLInputElement>("translationBatchSize");
const translationStyleFontSizeInput = byId<HTMLInputElement>("translationStyleFontSize");
const translationStyleColorInput = byId<HTMLInputElement>("translationStyleColor");
const translationStyleBackgroundInput = byId<HTMLInputElement>("translationStyleBackground");
const translationStyleBoldInput = byId<HTMLInputElement>("translationStyleBold");
const translationStyleItalicInput = byId<HTMLInputElement>("translationStyleItalic");
const unlockContextMenuInput = byId<HTMLInputElement>("unlockContextMenu");
const blockVisibilityDetectionInput = byId<HTMLInputElement>("blockVisibilityDetection");
const aggressiveVisibilityBypassInput = byId<HTMLInputElement>("aggressiveVisibilityBypass");
const blockFullscreenRequestsInput = byId<HTMLInputElement>("blockFullscreenRequests");
const autoSolveCurrentPageInput = byId<HTMLInputElement>("autoSolveCurrentPage");
const localCommandEnabledInput = byId<HTMLInputElement>("localCommandEnabled");
const localCommandWsUrlInput = byId<HTMLInputElement>("localCommandWsUrl");
const localCommandTokenInput = byId<HTMLInputElement>("localCommandToken");
const localCommandStatusEl = byId<HTMLSpanElement>("localCommandStatus");
const refreshLocalCommandStatusBtn = byId<HTMLButtonElement>("refreshLocalCommandStatus");
const apiProviderTabsEl = byId<HTMLDivElement>("apiProviderTabs");
const apiConfigEditTabBtn = byId<HTMLButtonElement>("apiConfigEditTabBtn");
const apiConfigListTabBtn = byId<HTMLButtonElement>("apiConfigListTabBtn");
const apiConfigEditPanelEl = byId<HTMLElement>("apiConfigEditPanel");
const apiConfigListPanelEl = byId<HTMLElement>("apiConfigListPanel");
const apiProviderListEl = byId<HTMLDivElement>("apiProviderList");
const apiProviderListStatusEl = byId<HTMLDivElement>("apiProviderListStatus");
const statusEl = byId<HTMLDivElement>("status");
const translationStatusEl = byId<HTMLDivElement>("translationStatus");
const injectionNoticeEl = byId<HTMLDivElement>("injectionNotice");
const contextEl = byId<HTMLPreElement>("context");
const chatModelInput = byId<HTMLSelectElement>("chatModel");
const chatInput = byId<HTMLTextAreaElement>("chatInput");
const chatActionBtn = byId<HTMLButtonElement>("chatAction");
const chatStatusEl = byId<HTMLDivElement>("chatStatus");
const chatMessagesEl = byId<HTMLDivElement>("chatMessages");
const examStatusEl = byId<HTMLDivElement>("examStatus");
const chatSessionsEl = byId<HTMLDivElement>("chatSessions");
const askAndAutoFillBtn = byId<HTMLButtonElement>("askAndAutoFill");
const settingsSubtabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".settings-subtab-btn"));
const settingsSubtabPanels = Array.from(document.querySelectorAll<HTMLElement>(".settings-subtab-panel"));

// ── Agent DOM elements ──
const agentMessagesEl = byId<HTMLDivElement>("agentMessages");
const agentStatusEl = byId<HTMLDivElement>("agentStatus");
const agentInput = byId<HTMLTextAreaElement>("agentInput");
const agentModelInput = byId<HTMLSelectElement>("agentModel");
const agentActionBtn = byId<HTMLButtonElement>("agentAction");
const toggleMemoriesBtn = byId<HTMLButtonElement>("toggleMemories");
const toggleSkillsBtn = byId<HTMLButtonElement>("toggleSkills");
const toggleTasksBtn = byId<HTMLButtonElement>("toggleTasks");
const agentIterInfoEl = byId<HTMLSpanElement>("agentIterInfo");
const agentSessionsEl = byId<HTMLDivElement>("agentSessions");
const skillsPanelEl = byId<HTMLDivElement>("skillsPanel");
const skillsListEl = byId<HTMLDivElement>("skillsList");
const skillImportFileEl = byId<HTMLInputElement>("skillImportFile");
const memoriesPanelEl = byId<HTMLDivElement>("memoriesPanel");
const memoriesListEl = byId<HTMLDivElement>("memoriesList");
const memoryImportFileEl = byId<HTMLInputElement>("memoryImportFile");
const tasksPanelEl = byId<HTMLDivElement>("tasksPanel");
const tasksListEl = byId<HTMLDivElement>("tasksList");

let chatState = createInitialChatState();
let activeStreamRequestId: string | null = null;
const streamCompletionResolvers = new Map<string, (ok: boolean) => void>();
let chatSessions: ChatSession[] = [];
let activeSessionId: string | null = null;
let latestExamQuestions: ExamQuestion[] = [];
let currentModels: string[] = [DEFAULT_CONFIG.model];
let activeSettingsSubtabId = "settingsConfigPanel";
let activeApiConfigSubtabId = "apiConfigListPanel";
let apiKeyVisible = false;
let apiProviders: ApiProvider[] = createDefaultApiProviders();
let activeApiProviderId = CUSTOM_API_PROVIDER_ID;
let formApiProviderId = CUSTOM_API_PROVIDER_ID;
interface ApiProviderInlineDraft {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  modelsText: string;
}

let activeApiProviderInlineEditId: string | null = null;
let activeApiProviderInlineDraft: ApiProviderInlineDraft | null = null;
const CONFIGURED_API_PROVIDER_ID_PREFIX = "configured:";

function sanitizeApiProviderForUi(provider: ApiProvider, fallbackId: string): ApiProvider {
  const sanitizeModel = (value: string): string => value.replace(/^[\s\u0000-\u001F\u007F]+|[\s\u0000-\u001F\u007F]+$/g, "");
  const rawId = typeof provider.id === "string" ? provider.id : "";
  const rawName = typeof provider.name === "string" ? provider.name : "";
  const rawBaseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl : "";
  const rawApiKey = typeof provider.apiKey === "string" ? provider.apiKey : "";
  const rawModel = typeof provider.model === "string" ? provider.model : "";
  const fallbackModel = sanitizeModel(rawModel) || DEFAULT_CONFIG.model;
  const models = Array.isArray(provider.models) && provider.models.length > 0
    ? provider.models
      .filter((item): item is string => typeof item === "string")
      .map((item) => sanitizeModel(item))
      .filter(Boolean)
    : [fallbackModel];
  const normalizedModels = models.includes(fallbackModel) ? models : [fallbackModel, ...models];

  return {
    id: rawId.trim() || fallbackId,
    name: rawName.trim() || rawId.trim() || "自定义",
    baseUrl: rawBaseUrl.trim(),
    apiKey: rawApiKey,
    model: fallbackModel,
    models: normalizedModels,
    builtIn: provider.builtIn === true
  };
}

function cloneApiProviders(providers: ApiProvider[]): ApiProvider[] {
  return providers.map((provider) => ({
    ...provider,
    models: [...provider.models]
  }));
}

function isApiProviderTemplate(provider: ApiProvider): boolean {
  return provider.builtIn === true || provider.id === CUSTOM_API_PROVIDER_ID;
}

function toConfiguredApiProviderId(providerId: string): string {
  return `${CONFIGURED_API_PROVIDER_ID_PREFIX}${providerId}`;
}

function createConfiguredApiProvider(template: ApiProvider): ApiProvider {
  return {
    ...template,
    id: toConfiguredApiProviderId(template.id),
    builtIn: false,
    models: [...template.models]
  };
}

function hasMaterializableTemplateData(provider: ApiProvider): boolean {
  if (provider.builtIn === true) {
    return Boolean(provider.apiKey.trim());
  }

  return Boolean(
    provider.baseUrl.trim() ||
    provider.apiKey.trim() ||
    provider.model.trim() !== DEFAULT_CONFIG.model ||
    provider.models.some((model) => model.trim() !== DEFAULT_CONFIG.model)
  );
}

function upsertConfiguredApiProvider(template: ApiProvider): ApiProvider {
  const configuredProvider = createConfiguredApiProvider(template);
  const existingIndex = apiProviders.findIndex((provider) => provider.id === configuredProvider.id);

  if (existingIndex >= 0) {
    apiProviders = apiProviders.map((provider, index) => (
      index === existingIndex
        ? configuredProvider
        : provider
    ));
  } else {
    apiProviders = [...apiProviders, configuredProvider];
  }

  return configuredProvider;
}

function materializeTemplateProvider(selectedProvider: ApiProvider | undefined): ApiProvider | undefined {
  if (!selectedProvider || !isApiProviderTemplate(selectedProvider) || !hasMaterializableTemplateData(selectedProvider)) {
    return undefined;
  }

  return upsertConfiguredApiProvider(selectedProvider);
}

function createCleanApiProviderTemplates(): ApiProvider[] {
  return createDefaultApiProviders().map((provider, index) =>
    sanitizeApiProviderForUi(provider, `template-${index + 1}`)
  );
}

function normalizeLoadedApiProvidersForUi(loadedProviders: ApiProvider[]): ApiProvider[] {
  const configuredProviders = new Map<string, ApiProvider>();

  for (const provider of loadedProviders) {
    const configuredProvider = isApiProviderTemplate(provider)
      ? (hasMaterializableTemplateData(provider) ? createConfiguredApiProvider(provider) : undefined)
      : provider;

    if (configuredProvider) {
      if (isApiProviderTemplate(provider) && configuredProviders.has(configuredProvider.id)) {
        continue;
      }
      configuredProviders.set(configuredProvider.id, configuredProvider);
    }
  }

  return [
    ...createCleanApiProviderTemplates(),
    ...Array.from(configuredProviders.values()).map((provider) => ({
      ...provider,
      builtIn: false,
      models: [...provider.models]
    }))
  ];
}

function resolveConfiguredProviderFromTemplate(templateProvider: ApiProvider | undefined): ApiProvider | undefined {
  if (!templateProvider || !isApiProviderTemplate(templateProvider)) {
    return undefined;
  }
  return apiProviders.find((provider) => provider.id === toConfiguredApiProviderId(templateProvider.id));
}

function findProviderByBaseUrlForUi(baseUrl: string): ApiProvider | undefined {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return undefined;
  }

  return apiProviders.find((provider) => (
    !isApiProviderTemplate(provider) &&
    normalizeBaseUrl(provider.baseUrl) === normalizedBaseUrl
  )) ?? apiProviders.find((provider) => (
    normalizeBaseUrl(provider.baseUrl) === normalizedBaseUrl
  ));
}

function findTemplateProviderForEdit(sourceProvider: ApiProvider | undefined): ApiProvider | undefined {
  if (!sourceProvider) {
    return apiProviders.find((provider) => provider.id === CUSTOM_API_PROVIDER_ID)
      ?? apiProviders.find((provider) => provider.builtIn === true)
      ?? apiProviders[0];
  }

  if (isApiProviderTemplate(sourceProvider)) {
    return sourceProvider;
  }

  const matchingBuiltIn = apiProviders.find((provider) => (
    provider.builtIn === true &&
    normalizeBaseUrl(provider.baseUrl) === normalizeBaseUrl(sourceProvider.baseUrl)
  ));
  if (matchingBuiltIn) {
    matchingBuiltIn.apiKey = sourceProvider.apiKey;
    matchingBuiltIn.model = sourceProvider.model;
    matchingBuiltIn.models = [...sourceProvider.models];
    return matchingBuiltIn;
  }

  const customTemplate = apiProviders.find((provider) => provider.id === CUSTOM_API_PROVIDER_ID);
  if (customTemplate) {
    customTemplate.baseUrl = sourceProvider.baseUrl;
    customTemplate.apiKey = sourceProvider.apiKey;
    customTemplate.model = sourceProvider.model;
    customTemplate.models = [...sourceProvider.models];
    return customTemplate;
  }

  return apiProviders.find((provider) => provider.builtIn === true) ?? apiProviders[0];
}

function getActiveApiProvider(providers = apiProviders, activeId = activeApiProviderId): ApiProvider | undefined {
  return providers.find((provider) => provider.id === activeId)
    ?? providers.find((provider) => provider.id === CUSTOM_API_PROVIDER_ID)
    ?? providers[0];
}

function getFormApiProvider(): ApiProvider | undefined {
  return getActiveApiProvider(apiProviders, formApiProviderId);
}

function normalizeModelList(models: string[], fallbackModel: string): string[] {
  const unique: string[] = [];
  for (const model of models) {
    const cleaned = model.replace(/^[\s\u0000-\u001F\u007F]+|[\s\u0000-\u001F\u007F]+$/g, "");
    if (cleaned && !unique.includes(cleaned)) {
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

function updateApiConfigSubtabUi(): void {
  const isEdit = activeApiConfigSubtabId === "apiConfigEditPanel";
  apiConfigEditTabBtn.classList.toggle("active", isEdit);
  apiConfigListTabBtn.classList.toggle("active", !isEdit);
  apiConfigEditPanelEl.classList.toggle("active", isEdit);
  apiConfigListPanelEl.classList.toggle("active", !isEdit);
}

function createApiProviderInlineDraft(provider: ApiProvider): ApiProviderInlineDraft {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    modelsText: provider.models.join("\n")
  };
}

function closeApiProviderInlineEditor(): void {
  activeApiProviderInlineEditId = null;
  activeApiProviderInlineDraft = null;
}

function openApiProviderInlineEditor(provider: ApiProvider): void {
  activeApiProviderInlineEditId = provider.id;
  activeApiProviderInlineDraft = createApiProviderInlineDraft(provider);
  renderApiProviderList();
}

function toggleApiProviderInlineEditor(provider: ApiProvider): void {
  if (activeApiProviderInlineEditId === provider.id) {
    closeApiProviderInlineEditor();
    renderApiProviderList();
    return;
  }

  openApiProviderInlineEditor(provider);
}

function updateApiProviderInlineDraft(patch: Partial<ApiProviderInlineDraft>): void {
  if (!activeApiProviderInlineDraft) {
    return;
  }
  activeApiProviderInlineDraft = {
    ...activeApiProviderInlineDraft,
    ...patch
  };
}

function parseApiProviderModelsDraft(modelsText: string, fallbackModel: string): string[] {
  const normalized = modelsText
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return normalizeModelList(normalized.length > 0 ? normalized : [fallbackModel], fallbackModel);
}

function buildApiProviderFromInlineDraft(provider: ApiProvider, draft: ApiProviderInlineDraft): { provider: ApiProvider; errors: string[] } {
  const errors: string[] = [];
  const name = draft.name.trim();
  const baseUrl = draft.baseUrl.trim();
  const model = draft.model.trim() || DEFAULT_CONFIG.model;

  if (!name) {
    errors.push("供应商名称不能为空");
  }
  if (!baseUrl) {
    errors.push("Base URL 不能为空");
  }

  return {
    provider: {
      ...provider,
      name: name || provider.name,
      baseUrl: normalizeBaseUrl(baseUrl || provider.baseUrl),
      apiKey: draft.apiKey,
      model,
      models: parseApiProviderModelsDraft(draft.modelsText, model)
    },
    errors
  };
}

function createApiProviderInlineField(
  label: string,
  control: HTMLInputElement | HTMLTextAreaElement,
  hint?: string
): HTMLLabelElement {
  const wrapper = document.createElement("label");
  wrapper.className = "api-provider-inline-field";

  const title = document.createElement("span");
  title.className = "api-provider-inline-field-label";
  title.textContent = label;
  wrapper.appendChild(title);
  wrapper.appendChild(control);

  if (hint) {
    const hintEl = document.createElement("span");
    hintEl.className = "api-provider-inline-field-hint";
    hintEl.textContent = hint;
    wrapper.appendChild(hintEl);
  }

  return wrapper;
}

function renderApiProviderInlineEditor(provider: ApiProvider): HTMLElement {
  const draft = activeApiProviderInlineDraft ?? createApiProviderInlineDraft(provider);
  activeApiProviderInlineDraft = draft;

  const editor = document.createElement("div");
  editor.className = "api-provider-list-item-editor";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = draft.name;
  nameInput.placeholder = "供应商名称";
  nameInput.addEventListener("input", () => {
    updateApiProviderInlineDraft({ name: nameInput.value });
  });

  const baseUrlInput = document.createElement("input");
  baseUrlInput.type = "text";
  baseUrlInput.value = draft.baseUrl;
  baseUrlInput.placeholder = "Base URL";
  baseUrlInput.addEventListener("input", () => {
    updateApiProviderInlineDraft({ baseUrl: baseUrlInput.value });
  });

  const apiKeyInput = document.createElement("input");
  apiKeyInput.type = "password";
  apiKeyInput.value = draft.apiKey;
  apiKeyInput.placeholder = "API Key";
  apiKeyInput.addEventListener("input", () => {
    updateApiProviderInlineDraft({ apiKey: apiKeyInput.value });
  });

  const modelInput = document.createElement("input");
  modelInput.type = "text";
  modelInput.value = draft.model;
  modelInput.placeholder = "默认模型";
  modelInput.addEventListener("input", () => {
    updateApiProviderInlineDraft({ model: modelInput.value });
  });

  const modelsTextarea = document.createElement("textarea");
  modelsTextarea.value = draft.modelsText;
  modelsTextarea.placeholder = "一行一个模型，或用逗号分隔";
  modelsTextarea.addEventListener("input", () => {
    updateApiProviderInlineDraft({ modelsText: modelsTextarea.value });
  });

  editor.appendChild(createApiProviderInlineField("名称", nameInput));
  editor.appendChild(createApiProviderInlineField("Base URL", baseUrlInput, "保留完整根地址即可，保存时会自动规范化。"));
  editor.appendChild(createApiProviderInlineField("API Key", apiKeyInput));
  editor.appendChild(createApiProviderInlineField("默认 Model", modelInput));
  editor.appendChild(createApiProviderInlineField("可用模型", modelsTextarea, "一行一个模型名，或用逗号分隔。保存时会自动去重并保留默认模型。"));

  const footer = document.createElement("div");
  footer.className = "api-provider-list-item-editor-actions";

  const saveBtn = createApiProviderActionButton(
    "保存",
    "保存当前编辑内容并收起",
    "edit",
    () => {
      void saveInlineApiProviderDraft(provider.id);
    }
  );
  saveBtn.classList.add("is-save");

  const cancelBtn = createApiProviderActionButton(
    "取消",
    "放弃修改并收起",
    "delete",
    () => {
      closeApiProviderInlineEditor();
      renderApiProviderList();
    }
  );
  cancelBtn.classList.add("is-cancel");

  footer.appendChild(saveBtn);
  footer.appendChild(cancelBtn);
  editor.appendChild(footer);

  return editor;
}

async function saveInlineApiProviderDraft(providerId: string): Promise<void> {
  const provider = apiProviders.find((item) => item.id === providerId);
  const draft = activeApiProviderInlineDraft;

  if (!provider || !draft) {
    closeApiProviderInlineEditor();
    renderApiProviderList();
    return;
  }

  const { provider: updatedProvider, errors } = buildApiProviderFromInlineDraft(provider, draft);
  if (errors.length > 0) {
    setStatus(errors.join("，"), true);
    setApiProviderListStatus(errors.join("，"), true);
    return;
  }

  apiProviders = apiProviders.map((item) => (item.id === providerId ? updatedProvider : item));
  closeApiProviderInlineEditor();

  if (providerId === activeApiProviderId) {
    applyApiProviderToForm(updatedProvider, { setEnabled: true });
  } else {
    renderApiProviderTabs();
    renderApiProviderList();
  }

  const saved = await saveConfig(`${updatedProvider.name} 已保存`, true);
  if (!saved) {
    return;
  }

  renderApiProviderTabs();
  refreshApiProviderListIfVisible();
}

function commitOpenApiProviderInlineDraft(): boolean {
  if (!activeApiProviderInlineEditId || !activeApiProviderInlineDraft) {
    return true;
  }

  const provider = apiProviders.find((item) => item.id === activeApiProviderInlineEditId);
  if (!provider) {
    closeApiProviderInlineEditor();
    return true;
  }

  const { provider: updatedProvider, errors } = buildApiProviderFromInlineDraft(provider, activeApiProviderInlineDraft);
  if (errors.length > 0) {
    const message = errors.join("，");
    setStatus(message, true);
    setApiProviderListStatus(message, true);
    return false;
  }

  apiProviders = apiProviders.map((item) => (item.id === provider.id ? updatedProvider : item));
  if (provider.id === activeApiProviderId) {
    applyApiProviderToForm(updatedProvider, { setEnabled: true });
  } else {
    renderApiProviderTabs();
    refreshApiProviderListIfVisible();
  }

  closeApiProviderInlineEditor();
  return true;
}

function activateApiConfigSubtab(tabId: "apiConfigEditPanel" | "apiConfigListPanel"): void {
  activeApiConfigSubtabId = tabId;
  if (tabId !== "apiConfigListPanel") {
    closeApiProviderInlineEditor();
  }
  updateApiConfigSubtabUi();
  if (tabId !== "apiConfigListPanel") {
    const editTemplate = findTemplateProviderForEdit(getActiveApiProvider());
    if (editTemplate) {
      applyApiProviderToForm(editTemplate);
    }
    return;
  }

  renderApiProviderList();
}

function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return "未设置";
  }
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}••••`;
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function createApiProviderActionButton(
  label: string,
  title: string,
  variant: "enable" | "edit" | "test" | "delete",
  onClick: () => void,
  disabled = false
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `api-provider-action-btn api-provider-action-btn--${variant}`;
  button.textContent = label;
  button.title = title;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function buildConfigForProvider(provider: ApiProvider, baseConfig = toConfig()): LLMConfig {
  const model = provider.model.replace(/^[\s\u0000-\u001F\u007F]+|[\s\u0000-\u001F\u007F]+$/g, "") || DEFAULT_CONFIG.model;
  return {
    ...baseConfig,
    baseUrl: normalizeBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey.trim(),
    model,
    models: normalizeModelList(provider.models, model),
    activeApiProviderId: provider.id,
    apiProviders: cloneApiProviders(apiProviders)
  };
}

function findFallbackActiveProviderId(excludeProviderId: string, baseConfig = toConfig()): string | undefined {
  const candidates = [
    ...apiProviders.filter((provider) => !isApiProviderTemplate(provider)),
    ...apiProviders.filter((provider) => isApiProviderTemplate(provider))
  ].filter((provider) => provider.id !== excludeProviderId);

  for (const candidate of candidates) {
    if (validateConfig(buildConfigForProvider(candidate, baseConfig)).valid) {
      return candidate.id;
    }
  }

  return candidates[0]?.id;
}

function renderApiProviderList(): void {
  apiProviderListEl.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const displayProviders = apiProviders.filter((provider) => {
    return !isApiProviderTemplate(provider);
  }).sort((a, b) => {
    if (a.id === activeApiProviderId) return -1;
    if (b.id === activeApiProviderId) return 1;
    if (a.id === activeApiProviderInlineEditId) return -1;
    if (b.id === activeApiProviderInlineEditId) return 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });

  if (displayProviders.length === 0) {
    const empty = document.createElement("div");
    empty.className = "api-provider-list-empty";
    empty.textContent = "暂无已添加的大模型配置，预设供应商仅用于新增时选择。";
    apiProviderListEl.appendChild(empty);
    return;
  }

  if (activeApiProviderInlineEditId && !displayProviders.some((provider) => provider.id === activeApiProviderInlineEditId)) {
    closeApiProviderInlineEditor();
  }

  for (const provider of displayProviders) {
    const isActive = provider.id === activeApiProviderId;
    const isEditing = provider.id === activeApiProviderInlineEditId;
    const item = document.createElement("article");
    item.className = "api-provider-list-item";
    item.classList.toggle("is-active", isActive);
    item.classList.toggle("is-editing", isEditing);
    item.dataset.providerId = provider.id;

    const header = document.createElement("div");
    header.className = "api-provider-list-item-header";

    const title = document.createElement("div");
    title.className = "api-provider-list-item-title";
    title.textContent = provider.name;
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "api-provider-list-item-actions";

    const enableBtn = createApiProviderActionButton(
      isActive ? "✓ 已启用" : "✓ 启用",
      isActive ? "当前配置正在使用中" : "切换为当前使用的配置",
      "enable",
      () => {
        void enableApiProvider(provider);
      },
      isActive
    );

    const editBtn = createApiProviderActionButton(
      isEditing ? "▴ 收起" : "✎ 编辑",
      isEditing ? "收起当前编辑区域" : "在当前列表中展开编辑内容",
      "edit",
      () => {
        toggleApiProviderInlineEditor(provider);
      }
    );

    const testBtn = createApiProviderActionButton(
      "🧪 测试",
      "使用该配置发起一次大模型连通性测试",
      "test",
      () => {
        void testApiProvider(provider);
      }
    );

    const deleteBtn = createApiProviderActionButton(
      "🗑 删除",
      `删除「${provider.name}」配置`,
      "delete",
      () => {
        void deleteApiProvider(provider);
      }
    );

    actions.appendChild(enableBtn);
    actions.appendChild(editBtn);
    actions.appendChild(testBtn);
    actions.appendChild(deleteBtn);

    const meta = document.createElement("div");
    meta.className = "api-provider-list-item-meta";
    meta.innerHTML = `
      <div><strong>Base URL：</strong>${provider.baseUrl || "未设置"}</div>
      <div><strong>API Key：</strong>${maskApiKey(provider.apiKey)}</div>
      <div><strong>Model：</strong>${provider.model || "未设置"}</div>
      <div><strong>模型数量：</strong>${provider.models.length}</div>
    `;

    item.appendChild(header);
    item.appendChild(meta);
    if (isEditing) {
      item.appendChild(renderApiProviderInlineEditor(provider));
    }
    item.appendChild(actions);
    fragment.appendChild(item);
  }

  apiProviderListEl.appendChild(fragment);

  const focusProviderId = activeApiProviderInlineEditId ?? activeApiProviderId;
  if (focusProviderId) {
    requestAnimationFrame(() => {
      const focusedItem = apiProviderListEl.querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(focusProviderId)}"]`);
      focusedItem?.scrollIntoView({ block: "nearest" });
    });
  }
}

function refreshApiProviderListIfVisible(): void {
  if (activeApiConfigSubtabId === "apiConfigListPanel") {
    renderApiProviderList();
  }
}

function syncFormProviderFromForm(): ApiProvider | undefined {
  const provider = getFormApiProvider();
  if (!provider) {
    return undefined;
  }

  if (provider.builtIn !== true) {
    provider.baseUrl = normalizeBaseUrl(baseUrlInput.value.trim());
  }

  provider.apiKey = apiKeyInput.value;
  provider.model = modelInput.value.replace(/^[\s\u0000-\u001F\u007F]+|[\s\u0000-\u001F\u007F]+$/g, "") || provider.model || DEFAULT_CONFIG.model;
  provider.models = normalizeModelList(currentModels, provider.model);
  refreshApiProviderListIfVisible();
  return provider;
}

function applyApiProviderToForm(provider: ApiProvider | undefined, options: { setEnabled?: boolean } = {}): void {
  const nextProvider = provider ?? apiProviders[0];
  if (!nextProvider) {
    return;
  }

  formApiProviderId = nextProvider.id;
  if (options.setEnabled) {
    activeApiProviderId = nextProvider.id;
  }
  apiKeyInput.value = nextProvider.apiKey ?? "";
  baseUrlInput.value = nextProvider.baseUrl ?? "";
  baseUrlInput.readOnly = nextProvider.builtIn === true;
  baseUrlInput.title = nextProvider.builtIn === true
    ? `${nextProvider.name} 是预设供应商，Base URL 已固定`
    : "可编辑当前供应商的 Base URL";

  currentModels = normalizeModelList([...nextProvider.models], nextProvider.model);
  renderModelSelect(nextProvider.model, nextProvider.model, nextProvider.model);
  renderApiProviderTabs();
  renderApiProviderList();
}

function generateApiProviderId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `provider-${slug || "custom"}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function renderApiProviderTabs(): void {
  apiProviderTabsEl.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const provider of apiProviders.filter((item) => isApiProviderTemplate(item))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "api-provider-tab";
    if (provider.id === formApiProviderId) {
      button.classList.add("active");
    }
    button.textContent = provider.name;
    button.title = provider.baseUrl || provider.name;
    button.addEventListener("click", () => {
      selectApiProviderForForm(provider.id);
    });
    fragment.appendChild(button);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "api-provider-add-btn";
  addButton.textContent = "+";
  addButton.title = "新增供应商";
  addButton.setAttribute("aria-label", "新增供应商");
  addButton.addEventListener("click", () => {
    void promptAndAddApiProvider();
  });
  fragment.appendChild(addButton);

  apiProviderTabsEl.appendChild(fragment);
}

function selectApiProviderForForm(providerId: string): void {
  closeApiProviderInlineEditor();
  const provider = apiProviders.find((item) => item.id === providerId)
    ?? apiProviders.find((item) => item.id === CUSTOM_API_PROVIDER_ID)
    ?? apiProviders[0];
  applyApiProviderToForm(provider);
}

function setActiveApiProvider(providerId: string): void {
  closeApiProviderInlineEditor();
  const provider = apiProviders.find((item) => item.id === providerId)
    ?? apiProviders.find((item) => item.id === CUSTOM_API_PROVIDER_ID)
    ?? apiProviders[0];
  applyApiProviderToForm(provider, { setEnabled: true });
}

function syncActiveApiProviderBaseUrl(value: string): void {
  const provider = getFormApiProvider();
  if (!provider || provider.builtIn === true) {
    return;
  }
  provider.baseUrl = normalizeBaseUrl(value);
  refreshApiProviderListIfVisible();
}

function syncActiveApiProviderModels(selectedModel = modelInput.value): void {
  const provider = getFormApiProvider();
  if (!provider) {
    return;
  }

  provider.model = selectedModel.replace(/^[\s\u0000-\u001F\u007F]+|[\s\u0000-\u001F\u007F]+$/g, "") || DEFAULT_CONFIG.model;
  provider.models = normalizeModelList(currentModels, provider.model);
  refreshApiProviderListIfVisible();
}

async function promptAndAddApiProvider(): Promise<void> {
  const name = window.prompt("请输入供应商名称", "新供应商")?.trim();
  if (!name) {
    return;
  }

  const baseUrl = window.prompt("请输入 Base URL", "https://api.example.com");
  if (baseUrl === null) {
    return;
  }
  if (!baseUrl.trim()) {
    setStatus("Base URL 不能为空", true);
    return;
  }

  const provider: ApiProvider = {
    id: generateApiProviderId(name),
    name,
    baseUrl: baseUrl.trim(),
    apiKey: "",
    model: DEFAULT_CONFIG.model,
    models: [DEFAULT_CONFIG.model],
    builtIn: false
  };

  apiProviders = [
    ...apiProviders.filter((item) => item.id !== provider.id),
    provider
  ];
  renderApiProviderTabs();
  activateApiConfigSubtab("apiConfigListPanel");
  openApiProviderInlineEditor(provider);
  setApiProviderListStatus(`已新增「${provider.name}」，请补充 API Key 后保存。`);
}

function setApiProvidersFromConfig(config: LLMConfig): void {
  closeApiProviderInlineEditor();
  const loadedProviders = Array.isArray(config.apiProviders) && config.apiProviders.length > 0
    ? config.apiProviders
    : createDefaultApiProviders({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        models: config.models
      });
  apiProviders = normalizeLoadedApiProvidersForUi(
    loadedProviders.map((provider, index) => sanitizeApiProviderForUi(provider, `provider-${index + 1}`))
  );

  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);
  const requestedProviderId = typeof config.activeApiProviderId === "string"
    ? config.activeApiProviderId.trim()
    : "";
  const requestedProvider = apiProviders.find((provider) => provider.id === requestedProviderId);
  const selectedProvider = resolveConfiguredProviderFromTemplate(requestedProvider)
    ?? requestedProvider
    ?? findProviderByBaseUrlForUi(normalizedBaseUrl)
    ?? apiProviders.find((provider) => provider.id === CUSTOM_API_PROVIDER_ID)
    ?? apiProviders[0];

  activeApiProviderId = selectedProvider.id;
  const editTemplate = findTemplateProviderForEdit(selectedProvider);
  applyApiProviderToForm(editTemplate ?? selectedProvider);
  syncFormProviderFromForm();
}

// ── Agent State ──
interface AgentToolCallEntry {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  isError?: boolean;
  status: "running" | "success" | "error";
}

interface AgentEntry {
  type: "user" | "assistant" | "thinking" | "tool";
  content: string;
  toolCall?: AgentToolCallEntry;
}

let agentEntries: AgentEntry[] = [];
let activeAgentRequestId: string | null = null;
let agentPending = false;
let agentSessions: AgentSession[] = [];
let activeAgentSessionId: string | null = null;
let activeAgentPanel: "memories" | "skills" | "tasks" | null = null;
let agentIterInfoText = "";
const inFlightAutoSolveSignatures = new Set<string>();
const completedAutoSolveSignatures = new Set<string>();

async function getCurrentTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function injectContentScript(tabId: number): Promise<void> {
  if (!chrome.scripting?.executeScript) {
    return;
  }

  const existing = await chrome.tabs.sendMessage(tabId, { type: "PING" }).catch(() => null);
  if (existing) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["pageFullscreenBlock.js"],
    world: "MAIN"
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function sendTabMessageWithAutoInject(
  tabId: number,
  message: unknown
): Promise<{
  response: { ok?: boolean; data?: unknown } | null;
  diagnosis: "insufficient_permission" | "dynamic_injection_failed" | "page_policy_blocked" | null;
}> {
  return sendMessageToTabWithEnsureDiagnosis<{ ok?: boolean; data?: unknown }>({
    tabId,
    message,
    sendMessage: chrome.tabs.sendMessage,
    ensureReceiver: async () => {
      await injectContentScript(tabId);
    }
  });
}

function setStatus(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.style.color = error ? "#b91c1c" : "#047857";
}

function setApiProviderListStatus(text: string, error = false): void {
  apiProviderListStatusEl.textContent = text;
  apiProviderListStatusEl.style.color = error ? "#b91c1c" : "#475569";
}

function updateApiKeyVisibilityButton(): void {
  apiKeyInput.type = apiKeyVisible ? "text" : "password";
  apiKeyVisibilityBtn.textContent = apiKeyVisible ? "🙈" : "👁";
  apiKeyVisibilityBtn.title = apiKeyVisible ? "隐藏 API Key" : "显示 API Key";
  apiKeyVisibilityBtn.setAttribute("aria-label", apiKeyVisible ? "隐藏 API Key" : "显示 API Key");
  apiKeyVisibilityBtn.classList.toggle("active", apiKeyVisible);
}

function setTranslationStatus(text: string, error = false): void {
  translationStatusEl.textContent = text;
  translationStatusEl.style.color = error ? "#b91c1c" : "#047857";
}

interface LocalCommandStatus {
  enabled: boolean;
  state: "disabled" | "connecting" | "connected" | "reconnecting" | "error";
  url: string;
  updatedAt: number;
  lastConnectedAt: number | null;
  lastError: string;
  readyState: number | null;
}

interface ExternalAgentRunStartedEvent {
  type: "AGENT_EXTERNAL_RUN_STARTED";
  payload: {
    requestId: string;
    senderId: string;
    tabId: number;
    userMessage: string;
    createdAt: number;
  };
}

interface AutoSolveCurrentPageRequestedEvent {
  type: "AUTO_SOLVE_CURRENT_PAGE_REQUESTED";
  payload: {
    tabId: number | null;
    questionCount: number;
    signature: string;
    reason: string;
    title: string;
    url: string;
    createdAt: number;
  };
}

function renderLocalCommandStatus(status: LocalCommandStatus | null): void {
  if (!status || !status.enabled || status.state === "disabled") {
    localCommandStatusEl.textContent = "WebSocket 未启用";
    localCommandStatusEl.style.color = "#6b7280";
    return;
  }

  if (status.state === "connected") {
    const time = status.lastConnectedAt
      ? new Date(status.lastConnectedAt).toLocaleTimeString("zh-CN", { hour12: false })
      : "";
    localCommandStatusEl.textContent = `WebSocket 已连接${time ? ` (${time})` : ""}`;
    localCommandStatusEl.style.color = "#047857";
    return;
  }

  if (status.state === "connecting") {
    localCommandStatusEl.textContent = `WebSocket 连接中: ${status.url}`;
    localCommandStatusEl.style.color = "#d97706";
    return;
  }

  if (status.state === "reconnecting") {
    localCommandStatusEl.textContent = `WebSocket 已断开，正在重连: ${status.url}`;
    localCommandStatusEl.style.color = "#d97706";
    return;
  }

  localCommandStatusEl.textContent = status.lastError
    ? `WebSocket 连接失败: ${status.lastError}`
    : "WebSocket 连接失败";
  localCommandStatusEl.style.color = "#b91c1c";
}

async function refreshLocalCommandStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_LOCAL_COMMAND_STATUS" });
    renderLocalCommandStatus(response?.ok ? response.data as LocalCommandStatus : null);
  } catch {
    renderLocalCommandStatus(null);
  }
}

function setInjectionNotice(text: string | null): void {
  if (!text) {
    injectionNoticeEl.hidden = true;
    injectionNoticeEl.textContent = "";
    return;
  }

  injectionNoticeEl.hidden = false;
  injectionNoticeEl.textContent = text;
}

// ── Incremental chat rendering ──
// During streaming we keep references to the last assistant bubble and thinking block
// so we can update them in-place instead of rebuilding the entire DOM.
let chatRenderedCount = 0;
let chatStreamingThinkingPre: HTMLPreElement | null = null;
let chatStreamingThinkingDetails: HTMLElement | null = null;
let chatStreamingBodyEl: HTMLDivElement | null = null;

function updateChatActionButton(): void {
  const isPending = chatState.pending || !!activeStreamRequestId;
  chatActionBtn.textContent = isPending ? "■" : "↑";
  chatActionBtn.title = isPending ? "停止" : "发送";
  chatActionBtn.setAttribute("aria-label", isPending ? "停止" : "发送");
}

function finalizeChatStreamUi(): void {
  updateChatActionButton();
}

function renderChatFull(): void {
  chatMessagesEl.innerHTML = "";
  chatRenderedCount = 0;
  chatStreamingThinkingPre = null;
  chatStreamingThinkingDetails = null;
  chatStreamingBodyEl = null;

  for (const msg of chatState.messages) {
    appendChatMessageDOM(msg, chatState.messages.indexOf(msg) === chatState.messages.length - 1);
    chatRenderedCount++;
  }

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  chatStatusEl.textContent = chatState.pending ? "AI 思考中..." : "";
  updateChatActionButton();
}

function appendChatMessageDOM(msg: { role: string; content: string; reasoning_content?: string }, isLast: boolean): void {
  const thinking = msg.reasoning_content;

  // Thinking block
  if (msg.role === "assistant" && thinking) {
    const details = document.createElement("details");
    details.className = "thinking-block";
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "\u{1F4AD} 思考过程";
    const pre = document.createElement("pre");
    pre.className = "thinking-body";
    pre.textContent = thinking;
    details.appendChild(summary);
    details.appendChild(pre);
    chatMessagesEl.appendChild(details);
    if (isLast) {
      chatStreamingThinkingPre = pre;
      chatStreamingThinkingDetails = details;
    }
  }

  const bubble = document.createElement("div");
  bubble.className = `msg msg-${msg.role}`;

  const role = document.createElement("span");
  role.className = "msg-role";
  role.textContent = msg.role === "user" ? "You" : msg.role === "assistant" ? "AI" : "System";

  const body = document.createElement("div");
  body.className = "msg-body";
  body.textContent = msg.content;

  bubble.appendChild(role);
  bubble.appendChild(body);
  chatMessagesEl.appendChild(bubble);

  if (isLast && msg.role === "assistant") {
    chatStreamingBodyEl = body;
    if (!thinking) {
      chatStreamingThinkingPre = null;
      chatStreamingThinkingDetails = null;
    }
  } else if (isLast) {
    chatStreamingBodyEl = null;
    chatStreamingThinkingPre = null;
    chatStreamingThinkingDetails = null;
  }
}

function renderChat(): void {
  const msgs = chatState.messages;

  // If messages were deleted or reset, do a full render
  if (msgs.length < chatRenderedCount) {
    renderChatFull();
    return;
  }

  // Append any new messages that haven't been rendered yet
  while (chatRenderedCount < msgs.length) {
    const msg = msgs[chatRenderedCount];
    const isLast = chatRenderedCount === msgs.length - 1;
    appendChatMessageDOM(msg, isLast);
    chatRenderedCount++;
  }

  // Incremental update for the last (streaming) assistant message
  if (msgs.length > 0) {
    const last = msgs[msgs.length - 1] as { role: string; content: string; reasoning_content?: string };
    if (last.role === "assistant") {
      // Update thinking in-place
      const thinking = last.reasoning_content;
      if (thinking) {
        if (chatStreamingThinkingPre) {
          chatStreamingThinkingPre.textContent = thinking;
        } else {
          // Need to create the thinking block (first thinking delta for this message)
          const details = document.createElement("details");
          details.className = "thinking-block";
          details.open = true;
          const summary = document.createElement("summary");
          summary.textContent = "\u{1F4AD} 思考过程";
          const pre = document.createElement("pre");
          pre.className = "thinking-body";
          pre.textContent = thinking;
          details.appendChild(summary);
          details.appendChild(pre);
          // Insert before the assistant bubble
          const assistantBubble = chatStreamingBodyEl?.parentElement;
          if (assistantBubble) {
            chatMessagesEl.insertBefore(details, assistantBubble);
          } else {
            chatMessagesEl.appendChild(details);
          }
          chatStreamingThinkingPre = pre;
          chatStreamingThinkingDetails = details;
        }
      }

      // Update content in-place
      if (chatStreamingBodyEl) {
        chatStreamingBodyEl.textContent = last.content;
      }
    }
  }

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  chatStatusEl.textContent = chatState.pending ? "AI 思考中..." : "";
  updateChatActionButton();
}

function setExamStatus(text: string): void {
  examStatusEl.textContent = text;
}

function createSessionTitle(session: ChatSession): string {
  const firstUserMessage = session.messages.find((message) => message.role === "user")?.content ?? "";
  if (firstUserMessage) {
    return firstUserMessage.slice(0, 30);
  }

  return "New Chat";
}

function currentSession(): ChatSession | undefined {
  if (!activeSessionId) {
    return undefined;
  }

  return chatSessions.find((session) => session.id === activeSessionId);
}

function ensureActiveSession(): ChatSession {
  const existing = currentSession();
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const created: ChatSession = {
    id: `chat-${now}-${Math.random().toString(16).slice(2)}`,
    title: "New Chat",
    createdAt: now,
    updatedAt: now,
    messages: []
  };

  chatSessions = [created, ...chatSessions];
  activeSessionId = created.id;
  return created;
}

function renderChatSessions(): void {
  chatSessionsEl.innerHTML = "";

  if (chatSessions.length === 0) {
    return;
  }

  for (const session of chatSessions) {
    const btn = document.createElement("button");
    btn.className = `s-btn${session.id === activeSessionId ? " active" : ""}`;
    btn.textContent = createSessionTitle(session);
    btn.title = new Date(session.updatedAt).toLocaleString();
    btn.addEventListener("click", () => {
      activeSessionId = session.id;
      chatState = {
        messages: session.messages,
        pending: false
      };
      renderChatSessions();
      renderChat();
    });
    chatSessionsEl.appendChild(btn);
  }
}

async function persistActiveSession(): Promise<void> {
  const session = ensureActiveSession();
  const now = Date.now();
  const updated: ChatSession = {
    ...session,
    title: createSessionTitle({ ...session, messages: chatState.messages }),
    updatedAt: now,
    messages: chatState.messages
  };

  chatSessions = [updated, ...chatSessions.filter((item) => item.id !== updated.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
  renderChatSessions();

  await chrome.runtime.sendMessage({
    type: "SAVE_CHAT_SESSION",
    payload: updated
  });
}

async function loadChatSessions(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "GET_CHAT_SESSIONS" });
  if (!response?.ok || !Array.isArray(response?.data)) {
    chatSessions = [];
    activeSessionId = null;
    renderChatSessions();
    return;
  }

  chatSessions = response.data as ChatSession[];
  if (chatSessions.length > 0) {
    activeSessionId = chatSessions[0].id;
    chatState = {
      messages: chatSessions[0].messages,
      pending: false
    };
  } else {
    activeSessionId = null;
    chatState = createInitialChatState();
  }

  renderChatSessions();
  renderChat();
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function dispatchChat(action: ChatStateAction): void {
  chatState = reduceChatState(chatState, action);
  renderChat();

  // Debounce persistence during streaming to avoid flooding the background
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistActiveSession();
  }, 500);
}

function toConfig(): LLMConfig {
  syncFormProviderFromForm();
  const activeProvider = getActiveApiProvider() ?? getFormApiProvider();
  const nextProviders = cloneApiProviders(apiProviders);

  return {
    baseUrl: normalizeBaseUrl(activeProvider?.baseUrl ?? baseUrlInput.value.trim()),
    apiKey: (activeProvider?.apiKey ?? apiKeyInput.value).trim(),
    model: (activeProvider?.model ?? modelInput.value).replace(/^[\s\u0000-\u001F\u007F]+|[\s\u0000-\u001F\u007F]+$/g, ""),
    models: normalizeModelList(activeProvider?.models ?? currentModels, activeProvider?.model ?? modelInput.value),
    temperature: DEFAULT_CONFIG.temperature,
    maxTokens: DEFAULT_CONFIG.maxTokens,
    agentMaxTokens: parseInt(agentMaxTokensInput.value, 10) || DEFAULT_CONFIG.agentMaxTokens,
    systemPrompt: DEFAULT_CONFIG.systemPrompt,
    translationEnabled: translationEnabledInput.checked,
    selectionTranslationEnabled: selectionTranslationEnabledInput.checked,
    translationTargetLanguage: translationTargetLanguageInput.value.trim() || DEFAULT_CONFIG.translationTargetLanguage,
    translationDisplayMode: translationDisplayModeInput.value === "bilingual" ? "bilingual" : "replace",
    translationStyleColor: translationStyleColorInput.value || DEFAULT_CONFIG.translationStyleColor,
    translationStyleBackground: translationStyleBackgroundInput.value || DEFAULT_CONFIG.translationStyleBackground,
    translationStyleFontSize: parseInt(translationStyleFontSizeInput.value, 10) || DEFAULT_CONFIG.translationStyleFontSize,
    translationStyleBold: translationStyleBoldInput.checked,
    translationStyleItalic: translationStyleItalicInput.checked,
    translationDebounceMs: parseInt(translationDebounceMsInput.value, 10) || DEFAULT_CONFIG.translationDebounceMs,
    translationBatchSize: parseInt(translationBatchSizeInput.value, 10) || DEFAULT_CONFIG.translationBatchSize,
    unlockContextMenu: unlockContextMenuInput.checked,
    blockVisibilityDetection: blockVisibilityDetectionInput.checked,
    aggressiveVisibilityBypass: aggressiveVisibilityBypassInput.checked,
    blockFullscreenRequests: blockFullscreenRequestsInput.checked,
    autoSolveCurrentPage: autoSolveCurrentPageInput.checked,
    enableFloatingBall: DEFAULT_CONFIG.enableFloatingBall,
    localCommandEnabled: localCommandEnabledInput.checked,
    localCommandWsUrl: localCommandWsUrlInput.value.trim() || DEFAULT_CONFIG.localCommandWsUrl,
    localCommandToken: localCommandTokenInput.value,
    thinkingFormat: (thinkingFormatInput.value as "none" | "field" | "blocks") ?? DEFAULT_CONFIG.thinkingFormat,
    apiProviders: nextProviders,
    activeApiProviderId: activeProvider?.id ?? activeApiProviderId
  };
}

function toChatConfig(): LLMConfig {
  return {
    ...toConfig(),
    model: chatModelInput.value.replace(/^[\s\u0000-\u001F\u007F]+|[\s\u0000-\u001F\u007F]+$/g, "") || DEFAULT_CONFIG.model
  };
}

function toAgentConfig(): LLMConfig {
  return {
    ...toConfig(),
    model: agentModelInput.value.replace(/^[\s\u0000-\u001F\u007F]+|[\s\u0000-\u001F\u007F]+$/g, "") || DEFAULT_CONFIG.model
  };
}

function renderModelSelect(selectedSettings?: string, selectedChat?: string, selectedAgent?: string): void {
  const previousChat = selectedChat ?? chatModelInput.value;
  const previousAgent = selectedAgent ?? agentModelInput.value;
  modelInput.innerHTML = "";
  chatModelInput.innerHTML = "";
  agentModelInput.innerHTML = "";
  for (const m of currentModels) {
    const settingsOpt = document.createElement("option");
    settingsOpt.value = m;
    settingsOpt.textContent = m;
    modelInput.appendChild(settingsOpt);

    const chatOpt = document.createElement("option");
    chatOpt.value = m;
    chatOpt.textContent = m;
    chatModelInput.appendChild(chatOpt);

    const agentOpt = document.createElement("option");
    agentOpt.value = m;
    agentOpt.textContent = m;
    agentModelInput.appendChild(agentOpt);
  }

  if (selectedSettings && currentModels.includes(selectedSettings)) {
    modelInput.value = selectedSettings;
  } else if (currentModels.length > 0) {
    modelInput.value = currentModels[0];
  }

  if (previousChat && currentModels.includes(previousChat)) {
    chatModelInput.value = previousChat;
  } else if (selectedSettings && currentModels.includes(selectedSettings)) {
    chatModelInput.value = selectedSettings;
  } else if (currentModels.length > 0) {
    chatModelInput.value = currentModels[0];
  }

  if (previousAgent && currentModels.includes(previousAgent)) {
    agentModelInput.value = previousAgent;
  } else if (selectedSettings && currentModels.includes(selectedSettings)) {
    agentModelInput.value = selectedSettings;
  } else if (currentModels.length > 0) {
    agentModelInput.value = currentModels[0];
  }
}

function toFeatureFlags(config: LLMConfig) {
  return {
    unlockContextMenu: config.unlockContextMenu,
    blockVisibilityDetection: config.blockVisibilityDetection,
    aggressiveVisibilityBypass: config.aggressiveVisibilityBypass,
    blockFullscreenRequests: config.blockFullscreenRequests,
    enableFloatingBall: config.enableFloatingBall
  };
}

async function loadConfig(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "GET_CONFIG" });
  if (!response?.ok) {
    setStatus("Load config failed", true);
    return;
  }

  const config = response.data as LLMConfig;
  setApiProvidersFromConfig(config);
  agentMaxTokensInput.value = String(config.agentMaxTokens ?? DEFAULT_CONFIG.agentMaxTokens);
  translationEnabledInput.checked = !!config.translationEnabled;
  selectionTranslationEnabledInput.checked = !!config.selectionTranslationEnabled;
  translationTargetLanguageInput.value = config.translationTargetLanguage ?? DEFAULT_CONFIG.translationTargetLanguage;
  translationDisplayModeInput.value = config.translationDisplayMode ?? DEFAULT_CONFIG.translationDisplayMode;
  translationDebounceMsInput.value = String(config.translationDebounceMs ?? DEFAULT_CONFIG.translationDebounceMs);
  translationBatchSizeInput.value = String(config.translationBatchSize ?? DEFAULT_CONFIG.translationBatchSize);
  translationStyleFontSizeInput.value = String(config.translationStyleFontSize ?? DEFAULT_CONFIG.translationStyleFontSize);
  translationStyleColorInput.value = config.translationStyleColor ?? DEFAULT_CONFIG.translationStyleColor;
  translationStyleBackgroundInput.value = config.translationStyleBackground ?? DEFAULT_CONFIG.translationStyleBackground;
  translationStyleBoldInput.checked = !!config.translationStyleBold;
  translationStyleItalicInput.checked = !!config.translationStyleItalic;
  unlockContextMenuInput.checked = config.unlockContextMenu;
  blockVisibilityDetectionInput.checked = config.blockVisibilityDetection;
  aggressiveVisibilityBypassInput.checked = config.aggressiveVisibilityBypass;
  blockFullscreenRequestsInput.checked = !!config.blockFullscreenRequests;
  autoSolveCurrentPageInput.checked = !!config.autoSolveCurrentPage;
  localCommandEnabledInput.checked = !!config.localCommandEnabled;
  localCommandWsUrlInput.value = config.localCommandWsUrl ?? DEFAULT_CONFIG.localCommandWsUrl;
  localCommandTokenInput.value = config.localCommandToken ?? DEFAULT_CONFIG.localCommandToken;
  thinkingFormatInput.value = config.thinkingFormat ?? DEFAULT_CONFIG.thinkingFormat;
  await refreshLocalCommandStatus();
  if (config.autoSolveCurrentPage) {
    setTimeout(() => {
      void refreshAutoSolveDetectionStatus({ solveWhenDetected: true });
    }, 500);
  }
}

function toTranslationPayload(config: LLMConfig) {
  return {
    translationEnabled: config.translationEnabled,
    selectionTranslationEnabled: config.selectionTranslationEnabled,
    translationTargetLanguage: config.translationTargetLanguage,
    translationDisplayMode: config.translationDisplayMode,
    translationStyleColor: config.translationStyleColor,
    translationStyleBackground: config.translationStyleBackground,
    translationStyleFontSize: config.translationStyleFontSize,
    translationStyleBold: config.translationStyleBold,
    translationStyleItalic: config.translationStyleItalic,
    translationDebounceMs: config.translationDebounceMs,
    translationBatchSize: config.translationBatchSize
  };
}

async function applyConfigToActiveTab(config: LLMConfig): Promise<void> {
  const tabId = await getCurrentTabId();
  if (!tabId) {
    setInjectionNotice("当前没有可用标签页，无法应用页面开关。");
    return;
  }

  const response = await sendTabMessageWithAutoInject(tabId, {
    type: "APPLY_FEATURE_FLAGS",
    payload: toFeatureFlags(config)
  });

  if (!response.response) {
    setInjectionNotice(
      response.diagnosis
        ? formatInjectionDiagnosisNotice(response.diagnosis)
        : "当前页面不支持注入内容脚本，页面开关不会生效。"
    );
    return;
  }

  setInjectionNotice(null);

  const translationResponse = await sendTabMessageWithAutoInject(tabId, {
    type: "APPLY_TRANSLATION_SETTINGS",
    payload: toTranslationPayload(config)
  });

  if (!translationResponse.response) {
    setInjectionNotice(
      translationResponse.diagnosis
        ? formatInjectionDiagnosisNotice(translationResponse.diagnosis)
        : "当前页面不支持应用翻译设置。"
    );
    return;
  }

  setInjectionNotice(null);

  const autoSolveResponse = await sendTabMessageWithAutoInject(tabId, {
    type: "APPLY_AUTO_SOLVE_SETTINGS",
    payload: { autoSolveCurrentPage: config.autoSolveCurrentPage }
  });

  if (!autoSolveResponse.response) {
    setInjectionNotice(
      autoSolveResponse.diagnosis
        ? formatInjectionDiagnosisNotice(autoSolveResponse.diagnosis)
        : "当前页面不支持应用自动解题设置。"
    );
    return;
  }

  setInjectionNotice(null);
}

async function applyTranslationToActiveTab(): Promise<void> {
  const tabId = await getCurrentTabId();
  if (!tabId) {
    setInjectionNotice("当前没有可用标签页，无法应用翻译。");
    return;
  }

  const config = toConfig();
  const saveResponse = await chrome.runtime.sendMessage({
    type: "SAVE_CONFIG",
    payload: config
  });

  if (!saveResponse?.ok) {
    const message = Array.isArray(saveResponse?.errors)
      ? saveResponse.errors.join(", ")
      : "Save config failed";
    setTranslationStatus(message, true);
    return;
  }

  const response = await sendTabMessageWithAutoInject(tabId, {
    type: "APPLY_TRANSLATION_SETTINGS",
    payload: toTranslationPayload(config)
  });

  if (!response.response) {
    setInjectionNotice(
      response.diagnosis
        ? formatInjectionDiagnosisNotice(response.diagnosis)
        : "当前页面不支持应用翻译设置。"
    );
    return;
  }

  setInjectionNotice(null);
  setTranslationStatus("翻译设置已保存并应用到当前页");
}

async function translateCurrentPage(): Promise<void> {
  const tabId = await getCurrentTabId();
  if (!tabId) {
    setInjectionNotice("当前没有可用标签页，无法翻译。");
    return;
  }

  const config = {
    ...toConfig(),
    translationEnabled: true
  };

  const statusResponse = await sendTabMessageWithAutoInject(tabId, {
    type: "CHECK_CURRENT_PAGE_TRANSLATION_STATUS",
    payload: toTranslationPayload(config)
  });

  if (!statusResponse.response) {
    setInjectionNotice(
      statusResponse.diagnosis
        ? formatInjectionDiagnosisNotice(statusResponse.diagnosis)
        : "当前页面不支持应用翻译设置。"
    );
    setTranslationStatus("当前页面不支持翻译", true);
    return;
  }

  const statusData = statusResponse.response.data as { translated?: boolean; count?: number } | undefined;
  if (statusData?.translated) {
    setInjectionNotice(null);
    setTranslationStatus(`当前页面已翻译，不重复请求${typeof statusData.count === "number" ? `（${statusData.count} 段）` : ""}`);
    return;
  }

  setTranslationStatus("正在翻译当前页面...");

  const response = await sendTabMessageWithAutoInject(tabId, {
    type: "TRANSLATE_CURRENT_PAGE_ONCE",
    payload: toTranslationPayload(config)
  });

  if (!response.response) {
    setInjectionNotice(
      response.diagnosis
        ? formatInjectionDiagnosisNotice(response.diagnosis)
        : "当前页面不支持应用翻译设置。"
    );
    setTranslationStatus("当前页面不支持翻译", true);
    return;
  }

  setInjectionNotice(null);
  const data = response.response.data as { skipped?: boolean; count?: number } | undefined;
  if (data?.skipped) {
    setTranslationStatus(`当前页面已翻译，不重复请求${typeof data.count === "number" ? `（${data.count} 段）` : ""}`);
    return;
  }

  setTranslationStatus("已开始翻译当前页面");
}

async function clearTranslationsFromActiveTab(): Promise<void> {
  const tabId = await getCurrentTabId();
  if (!tabId) {
    setInjectionNotice("当前没有可用标签页，无法清除译文。");
    return;
  }

  const response = await sendTabMessageWithAutoInject(tabId, {
    type: "CLEAR_TRANSLATIONS"
  });

  if (!response.response) {
    setInjectionNotice(
      response.diagnosis
        ? formatInjectionDiagnosisNotice(response.diagnosis)
        : "当前页面不支持清除译文。"
    );
    return;
  }

  setInjectionNotice(null);
  setTranslationStatus("当前页译文已清除");
}

async function saveConfig(successMessage = "Config saved", showApiProviderListAfterSave = false): Promise<boolean> {
  if (!commitOpenApiProviderInlineDraft()) {
    return false;
  }

  const config = toConfig();
  const response = await chrome.runtime.sendMessage({
    type: "SAVE_CONFIG",
    payload: config
  });

  if (!response?.ok) {
    const message = Array.isArray(response?.errors)
      ? response.errors.join(", ")
      : "Save config failed";
    if (showApiProviderListAfterSave) {
      activateApiConfigSubtab("apiConfigListPanel");
      renderApiProviderList();
    }
    setStatus(message, true);
    return false;
  }

  try {
    await applyConfigToActiveTab(config);
  } catch {
    // ignored
  }

  if (showApiProviderListAfterSave) {
    activateApiConfigSubtab("apiConfigListPanel");
  } else {
    refreshApiProviderListIfVisible();
  }

  setStatus(successMessage);
  setTimeout(() => {
    void refreshLocalCommandStatus();
  }, 300);
  return true;
}

async function handleFeatureSwitchChange(options: { refreshAutoSolve?: boolean } = {}): Promise<void> {
  const saved = await saveConfig("功能开关已生效");
  if (!saved) {
    return;
  }

  if (options.refreshAutoSolve) {
    await refreshAutoSolveDetectionStatus({ solveWhenDetected: true });
  }
}

async function testConfig(
  config: LLMConfig,
  label = "大模型配置",
  statusSetter: (text: string, error?: boolean) => void = setStatus
): Promise<boolean> {
  statusSetter(`正在测试${label}...`);

  const response = await chrome.runtime.sendMessage({
    type: "TEST_LLM_CONFIG",
    payload: config
  });

  if (!response?.ok) {
    const message = Array.isArray(response?.errors)
      ? response.errors.join(", ")
      : `${label}测试失败`;
    statusSetter(message, true);
    return false;
  }

  const data = response.data as { model?: string; latencyMs?: number; content?: string };
  const latency = typeof data.latencyMs === "number" ? `，耗时 ${data.latencyMs}ms` : "";
  statusSetter(`${label}可用：${data.model ?? config.model}${latency}`);
  return true;
}

async function testLlmConfig(): Promise<void> {
  await testConfig(toConfig(), "当前大模型配置");
}

async function testApiProvider(provider: ApiProvider): Promise<void> {
  await testConfig(buildConfigForProvider(provider), `${provider.name} 配置`, setApiProviderListStatus);
}

async function enableApiProvider(provider: ApiProvider): Promise<void> {
  setActiveApiProvider(provider.id);
  const saved = await saveConfig(`${provider.name} 已启用`);
  if (!saved) {
    await loadConfig();
  }
}

async function deleteApiProvider(provider: ApiProvider): Promise<void> {
  if (provider.builtIn === true) {
    setStatus("预设供应商不能从已添加列表中删除", true);
    return;
  }

  const confirmed = window.confirm(`确定删除「${provider.name}」配置吗？删除后无法恢复。`);
  if (!confirmed) {
    return;
  }

  const previousConfig = toConfig();
  const wasActive = provider.id === activeApiProviderId;
  const wasEditing = provider.id === activeApiProviderInlineEditId;
  if (wasEditing) {
    closeApiProviderInlineEditor();
  }
  apiProviders = apiProviders.filter((item) => item.id !== provider.id);

  if (wasActive) {
    const fallbackId = findFallbackActiveProviderId(provider.id, previousConfig);
    if (fallbackId) {
      setActiveApiProvider(fallbackId);
    } else {
      renderApiProviderTabs();
      renderApiProviderList();
    }
  } else {
    renderApiProviderTabs();
    renderApiProviderList();
  }

  const saved = await saveConfig(`${provider.name} 已删除`);
  if (!saved) {
    await loadConfig();
    return;
  }
}

async function exportConfig(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_CONFIG" });
    if (!response?.ok) {
      setStatus("导出失败", true);
      return;
    }
    const config = response.data as LLMConfig;
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neonagent-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("配置已导出");
  } catch {
    setStatus("导出失败", true);
  }
}

const configImportFileEl = byId<HTMLInputElement>("configImportFile");

function triggerImportConfig(): void {
  configImportFileEl.value = "";
  configImportFileEl.click();
}

configImportFileEl.addEventListener("change", () => {
  const file = configImportFileEl.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const text = reader.result as string;
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || typeof parsed.baseUrl !== "string") {
        setStatus("无效的配置文件", true);
        return;
      }

      const config = migrateConfig(parsed as LLMConfig);
      const validation = validateConfig(config);
      if (!validation.valid) {
        setStatus("配置校验失败: " + validation.errors.join(", "), true);
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: "SAVE_CONFIG",
        payload: config
      });

      if (!response?.ok) {
        const message = Array.isArray(response?.errors)
          ? response.errors.join(", ")
          : "导入失败";
        setStatus(message, true);
        return;
      }

      // Reload UI with imported config
      setApiProvidersFromConfig(config);
      agentMaxTokensInput.value = String(config.agentMaxTokens ?? DEFAULT_CONFIG.agentMaxTokens);
      translationEnabledInput.checked = !!config.translationEnabled;
      selectionTranslationEnabledInput.checked = !!config.selectionTranslationEnabled;
      translationTargetLanguageInput.value = config.translationTargetLanguage ?? DEFAULT_CONFIG.translationTargetLanguage;
      translationDisplayModeInput.value = config.translationDisplayMode ?? DEFAULT_CONFIG.translationDisplayMode;
      translationDebounceMsInput.value = String(config.translationDebounceMs ?? DEFAULT_CONFIG.translationDebounceMs);
      translationBatchSizeInput.value = String(config.translationBatchSize ?? DEFAULT_CONFIG.translationBatchSize);
      translationStyleFontSizeInput.value = String(config.translationStyleFontSize ?? DEFAULT_CONFIG.translationStyleFontSize);
      translationStyleColorInput.value = config.translationStyleColor ?? DEFAULT_CONFIG.translationStyleColor;
      translationStyleBackgroundInput.value = config.translationStyleBackground ?? DEFAULT_CONFIG.translationStyleBackground;
      translationStyleBoldInput.checked = !!config.translationStyleBold;
      translationStyleItalicInput.checked = !!config.translationStyleItalic;
      unlockContextMenuInput.checked = config.unlockContextMenu;
      blockVisibilityDetectionInput.checked = config.blockVisibilityDetection;
      aggressiveVisibilityBypassInput.checked = config.aggressiveVisibilityBypass;
      blockFullscreenRequestsInput.checked = !!config.blockFullscreenRequests;
      autoSolveCurrentPageInput.checked = !!config.autoSolveCurrentPage;
      localCommandEnabledInput.checked = !!config.localCommandEnabled;
      localCommandWsUrlInput.value = config.localCommandWsUrl ?? DEFAULT_CONFIG.localCommandWsUrl;
      localCommandTokenInput.value = config.localCommandToken ?? DEFAULT_CONFIG.localCommandToken;

      try {
        await applyConfigToActiveTab(config);
      } catch {
        // ignored
      }

      setTimeout(() => {
        void refreshLocalCommandStatus();
      }, 300);
      setStatus("配置已导入");
    } catch {
      setStatus("文件解析失败", true);
    }
  };
  reader.readAsText(file);
});

const loadPageContext = createLoadPageContextAction(
  {
    getCurrentTabId,
    sendTabMessage: async (tabId, message) => {
      const result = await sendTabMessageWithAutoInject(tabId, message);
      if (result.response === null) {
        if (result.diagnosis) {
          throw new TabInjectionDiagnosticError(result.diagnosis);
        }

        throw new Error("Could not establish connection. Receiving end does not exist.");
      }

      return result.response;
    }
  },
  {
    setContext: (text) => {
      contextEl.textContent = text;
    },
    setPageTabActive: () => {
      activateTab("tabSettings");
      activateSettingsSubtab("settingsPagePanel");
    },
    setInjectionNotice
  }
);

async function sendChatMessage(): Promise<void> {
  const input = chatInput.value;
  chatInput.value = "";
  if (!input.trim()) {
    return;
  }

  await sendChatMessageWithContent(input);
}

async function sendChatMessageWithContent(
  input: string,
  options?: { includePageContext?: boolean }
): Promise<boolean> {
  const includePageContext = options?.includePageContext ?? true;
  dispatchChat({ type: "SEND_USER_MESSAGE", content: input });

  const outboundMessages = chatState.messages;
  dispatchChat({ type: "SET_PENDING", pending: true });
  dispatchChat({ type: "START_ASSISTANT_STREAM" });

  const requestId = `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  activeStreamRequestId = requestId;

  const donePromise = new Promise<boolean>((resolve) => {
    streamCompletionResolvers.set(requestId, resolve);
  });

  try {
    const response = await chrome.runtime.sendMessage(
      createLLMStreamRequestMessage({
        requestId,
        config: toChatConfig(),
        messages: outboundMessages,
        pageContext: includePageContext ? (contextEl.textContent || undefined) : undefined
      })
    );

    if (!response?.ok) {
      const message = Array.isArray(response?.errors)
        ? response.errors.join(", ")
        : "LLM stream request failed";
      dispatchChat({ type: "APPEND_ASSISTANT_DELTA", delta: `Error: ${message}` });
      dispatchChat({ type: "SET_PENDING", pending: false });
      activeStreamRequestId = null;
      finalizeChatStreamUi();
      const resolve = streamCompletionResolvers.get(requestId);
      if (resolve) {
        resolve(false);
        streamCompletionResolvers.delete(requestId);
      }
      return false;
    }
  } catch (error) {
    dispatchChat({
      type: "APPEND_ASSISTANT_DELTA",
      delta: `Error: ${error instanceof Error ? error.message : "Unknown error"}`
    });
    dispatchChat({ type: "SET_PENDING", pending: false });
    activeStreamRequestId = null;
    finalizeChatStreamUi();
    const resolve = streamCompletionResolvers.get(requestId);
    if (resolve) {
      resolve(false);
      streamCompletionResolvers.delete(requestId);
    }
    return false;
  }

  return donePromise;
}

async function stopChatMessage(): Promise<void> {
  if (!activeStreamRequestId) {
    return;
  }

  const requestId = activeStreamRequestId;
  activeStreamRequestId = null;

  try {
    await chrome.runtime.sendMessage(createLLMStreamCancelMessage({ requestId }));
  } finally {
    dispatchChat({ type: "SET_PENDING", pending: false });
    finalizeChatStreamUi();
    const resolve = streamCompletionResolvers.get(requestId);
    if (resolve) {
      resolve(false);
      streamCompletionResolvers.delete(requestId);
    }
  }
}

function formatQuestionsForPrompt(questions: ExamQuestion[]): string {
  return questions
    .map((question, index) => {
      const typeHint =
        question.questionType === "multiple"
          ? "[多选]"
          : question.questionType === "judgement"
            ? "[判断]"
            : "[单选]";
      const options = question.options.map((option) => `${option.label}. ${option.text}`).join(" ");
      return `${index + 1}. ${typeHint} ${question.stem}\n${options}`;
    })
    .join("\n\n");
}

function buildExamQuestionsSignature(questions: ExamQuestion[]): string {
  return questions
    .map((question) => {
      const type = question.questionType ?? "single";
      const stem = question.stem
        .replace(/已完成\s*\d+\s*\/\s*\d+\s*题/gi, "")
        .replace(/剩余[:：]?\s*\d{1,2}:\d{2}:\d{2}/gi, "")
        .replace(/座位号[:：]?\s*\S+/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      return `${stem}::${type}::${question.options.length}`;
    })
    .join("\n")
    .slice(0, 12000);
}

async function detectExamQuestions(): Promise<void> {
  await detectExamQuestionsInternal();
}

async function detectExamQuestionsInternal(): Promise<ExamQuestion[]> {
  const tabId = await getCurrentTabId();
  if (!tabId) {
    setExamStatus("当前没有可检测的活动标签页。");
    return [];
  }

  const response = await sendTabMessageWithAutoInject(tabId, { type: "GET_EXAM_QUESTIONS" });
  if (!response.response?.ok) {
    setExamStatus("当前页面题目检测失败。");
    return [];
  }

  const questions = ((response.response.data as ExamQuestion[] | undefined) ?? []).filter(
    (item) => item && typeof item.id === "string" && Array.isArray(item.options)
  );
  latestExamQuestions = questions;

  if (questions.length === 0) {
    setExamStatus("当前页面未检测到需要答题的题目。");
    return [];
  }

  setExamStatus(`当前页面检测到 ${questions.length} 道题。`);
  contextEl.textContent = formatQuestionsForPrompt(questions);
  return questions;
}

async function claimAutoSolveRun(signature: string, tabId?: number): Promise<boolean> {
  if (!signature) {
    return false;
  }

  const currentTabId = tabId ?? await getCurrentTabId();
  if (!currentTabId) {
    return false;
  }

  const tab = await chrome.tabs.get(currentTabId).catch(() => null);
  const response = await chrome.runtime.sendMessage({
    type: "CLAIM_AUTO_SOLVE_RUN",
    payload: {
      tabId: currentTabId,
      url: tab?.url ?? "",
      signature
    }
  }).catch(() => null);

  return !!response?.ok && !!response.data?.shouldRun;
}

async function refreshAutoSolveDetectionStatus(options?: { solveWhenDetected?: boolean }): Promise<void> {
  if (!autoSolveCurrentPageInput.checked) {
    setExamStatus("当前页面自动解题未启用。");
    return;
  }

  if (chatState.pending || activeStreamRequestId) {
    setExamStatus("正在检测当前页面是否需要答题，等待当前回答结束。");
    setTimeout(() => {
      void refreshAutoSolveDetectionStatus(options);
    }, 1500);
    return;
  }

  setExamStatus("正在检测当前页面是否需要答题...");
  const questions = await detectExamQuestionsInternal();
  if (questions.length === 0) {
    return;
  }

  setExamStatus(`检测到 ${questions.length} 道题，准备自动解题...`);
  if (!options?.solveWhenDetected) {
    return;
  }

  const signature = buildExamQuestionsSignature(questions);
  const shouldRun = await claimAutoSolveRun(signature);
  if (!shouldRun) {
    setExamStatus(`检测到 ${questions.length} 道题，页面和题目未变化，不重复答题。`);
    return;
  }

  await askAndAutoFill({ source: "auto" });
}

function buildExamPrompt(questions: ExamQuestion[]): string {
  const body = formatQuestionsForPrompt(questions);
  return [
    "你是考试答题助手。",
    "请基于下列题目给出最可能答案，只输出答案，不要解释。",
    "输出格式严格如下：",
    "- 单选题: 1. A",
    "- 多选题: 2. A,C",
    "- 判断题: 3. A",
    "只输出每题答案行，不要输出其它内容。",
    "如果不确定也要给出最可能选项。",
    "",
    "题目：",
    body
  ].join("\n");
}

async function askAndAutoFill(options?: { source?: "manual" | "auto" }): Promise<void> {
  if (chatState.pending || activeStreamRequestId) {
    setExamStatus(options?.source === "auto" ? "自动解题等待当前回答结束。" : "AI 正在回答中。");
    return;
  }

  askAndAutoFillBtn.disabled = true;
  let activeSignature = "";
  try {
    if (options?.source === "auto") {
      setExamStatus("检测到题目，正在自动解题...");
    }

    const questions = await detectExamQuestionsInternal();
    if (questions.length === 0) {
      return;
    }

    activeSignature = buildExamQuestionsSignature(questions);
    if (options?.source === "auto" && activeSignature) {
      if (inFlightAutoSolveSignatures.has(activeSignature) || completedAutoSolveSignatures.has(activeSignature)) {
        setExamStatus("当前题目已请求过答案，不重复答题。");
        return;
      }
      inFlightAutoSolveSignatures.add(activeSignature);
    }

    setExamStatus("正在请求模型解题...");
    const success = await sendChatMessageWithContent(buildExamPrompt(questions), {
      includePageContext: false
    });
    if (!success) {
      setExamStatus("模型解题请求失败。");
      return;
    }

    if (options?.source === "auto" && activeSignature) {
      completedAutoSolveSignatures.add(activeSignature);
      if (completedAutoSolveSignatures.size > 50) {
        const oldest = completedAutoSolveSignatures.values().next().value;
        if (oldest) completedAutoSolveSignatures.delete(oldest);
      }
    }
    setExamStatus("模型已给出答案，不自动填充页面。");
  } finally {
    if (activeSignature) {
      inFlightAutoSolveSignatures.delete(activeSignature);
    }
    askAndAutoFillBtn.disabled = false;
  }
}

async function handleAutoSolveCurrentPageRequest(event: AutoSolveCurrentPageRequestedEvent): Promise<void> {
  if (!event.payload.signature) {
    return;
  }

  const activeTabId = await getCurrentTabId();
  if (event.payload.tabId !== null && activeTabId !== event.payload.tabId) {
    return;
  }

  if (chatState.pending || activeStreamRequestId) {
    setExamStatus("自动解题等待当前回答结束。");
    setTimeout(() => {
      void handleAutoSolveCurrentPageRequest(event);
    }, 1500);
    return;
  }

  await chrome.runtime.sendMessage({
    type: "CLEAR_PENDING_AUTO_SOLVE_REQUEST",
    payload: { signature: event.payload.signature }
  }).catch(() => {
    // ignored
  });
  activateTab("tabChat");
  await askAndAutoFill({ source: "auto" });
}

async function loadPendingAutoSolveRequest(): Promise<boolean> {
  const tabId = await getCurrentTabId();
  const response = await chrome.runtime.sendMessage({
    type: "GET_PENDING_AUTO_SOLVE_REQUEST",
    payload: { tabId }
  }).catch(() => null);

  if (!response?.ok || !response.data) {
    return false;
  }

  await handleAutoSolveCurrentPageRequest(response.data as AutoSolveCurrentPageRequestedEvent);
  return true;
}

async function createNewChat(): Promise<void> {
  chatState = createInitialChatState();
  activeSessionId = null;
  latestExamQuestions = [];
  setExamStatus("");
  await persistActiveSession();
  renderChat();
}

async function deleteCurrentChat(): Promise<void> {
  if (!activeSessionId) {
    return;
  }

  const sessionId = activeSessionId;
  await chrome.runtime.sendMessage({
    type: "DELETE_CHAT_SESSION",
    payload: { sessionId }
  });

  chatSessions = chatSessions.filter((session) => session.id !== sessionId);
  if (chatSessions.length > 0) {
    activeSessionId = chatSessions[0].id;
    chatState = {
      messages: chatSessions[0].messages,
      pending: false
    };
  } else {
    activeSessionId = null;
    chatState = createInitialChatState();
  }

  renderChatSessions();
  renderChat();
}

async function clearAllChats(): Promise<void> {
  await chrome.runtime.sendMessage({ type: "CLEAR_CHAT_SESSIONS" });
  chatSessions = [];
  activeSessionId = null;
  chatState = createInitialChatState();
  renderChatSessions();
  renderChat();
}

function handleStreamEvent(event: RuntimeStreamEvent): void {
  if (!activeStreamRequestId || event.payload.requestId !== activeStreamRequestId) {
    return;
  }

  if (event.type === "LLM_STREAM_CHUNK") {
    if (event.payload.reasoning) {
      dispatchChat({ type: "APPEND_THINKING_DELTA", delta: event.payload.reasoning });
    }
    if (event.payload.delta) {
      dispatchChat({ type: "APPEND_ASSISTANT_DELTA", delta: event.payload.delta });
    }
    return;
  }

  if (event.type === "LLM_STREAM_ERROR") {
    dispatchChat({ type: "APPEND_ASSISTANT_DELTA", delta: `Error: ${event.payload.error}` });
    dispatchChat({ type: "SET_PENDING", pending: false });
    const resolve = streamCompletionResolvers.get(event.payload.requestId);
    if (resolve) {
      resolve(false);
      streamCompletionResolvers.delete(event.payload.requestId);
    }
    activeStreamRequestId = null;
    finalizeChatStreamUi();
    return;
  }

  if (event.type === "LLM_STREAM_DONE") {
    dispatchChat({ type: "SET_PENDING", pending: false });
    const resolve = streamCompletionResolvers.get(event.payload.requestId);
    if (resolve) {
      resolve(true);
      streamCompletionResolvers.delete(event.payload.requestId);
    }
    activeStreamRequestId = null;
    finalizeChatStreamUi();
  }
}

// ── Agent Functions ──

function setAgentStatus(text: string): void {
  agentStatusEl.textContent = text;
}

function setAgentIterationInfo(text: string): void {
  agentIterInfoText = text;
  agentIterInfoEl.textContent = text;
}

function showAgentPanel(panel: "memories" | "skills" | "tasks" | null): void {
  activeAgentPanel = panel;
  memoriesPanelEl.hidden = panel !== "memories";
  skillsPanelEl.hidden = panel !== "skills";
  tasksPanelEl.hidden = panel !== "tasks";

  toggleMemoriesBtn.classList.toggle("active", panel === "memories");
  toggleSkillsBtn.classList.toggle("active", panel === "skills");
  toggleTasksBtn.classList.toggle("active", panel === "tasks");
}

function updateAgentActionButton(): void {
  const isPending = agentPending || !!activeAgentRequestId;
  agentActionBtn.textContent = isPending ? "■" : "↑";
  agentActionBtn.title = isPending ? "停止" : "发送";
  agentActionBtn.setAttribute("aria-label", isPending ? "停止" : "发送");
}

function renderAgent(): void {
  agentIterInfoEl.textContent = agentIterInfoText;
  agentMessagesEl.innerHTML = "";

  for (const entry of agentEntries) {
    if (entry.type === "user") {
      const bubble = document.createElement("div");
      bubble.className = "msg msg-user";
      const role = document.createElement("span");
      role.className = "msg-role";
      role.textContent = "You";
      const body = document.createElement("div");
      body.className = "msg-body";
      body.textContent = entry.content;
      bubble.appendChild(role);
      bubble.appendChild(body);
      agentMessagesEl.appendChild(bubble);
    } else if (entry.type === "thinking") {
      const details = document.createElement("details");
      details.className = "thinking-block";
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = "\u{1F4AD} 思考过程";
      const pre = document.createElement("pre");
      pre.className = "thinking-body";
      pre.textContent = entry.content;
      details.appendChild(summary);
      details.appendChild(pre);
      agentMessagesEl.appendChild(details);
    } else if (entry.type === "tool" && entry.toolCall) {
      const tc = entry.toolCall;
      const card = document.createElement("div");
      card.className = "tool-call-card";

      const header = document.createElement("div");
      header.className = "tool-call-header";
      const icon = document.createElement("span");
      icon.className = "tool-icon";
      icon.textContent = "\u{1F527}";
      const name = document.createElement("span");
      name.className = "tool-name";
      name.textContent = tc.name;
      const status = document.createElement("span");
      status.className = `tool-status ${tc.status}`;
      status.textContent =
        tc.status === "running" ? "运行中..." :
        tc.status === "error" ? "失败" : "完成";
      header.appendChild(icon);
      header.appendChild(name);
      header.appendChild(status);
      card.appendChild(header);

      const body = document.createElement("div");
      body.className = "tool-call-body";

      // Arguments
      const argsLabel = document.createElement("div");
      argsLabel.className = "tool-section-label";
      argsLabel.textContent = "参数";
      body.appendChild(argsLabel);
      const argsPre = document.createElement("pre");
      try {
        argsPre.textContent = JSON.stringify(JSON.parse(tc.arguments), null, 2);
      } catch {
        argsPre.textContent = tc.arguments;
      }
      body.appendChild(argsPre);

      // Result (if available)
      if (tc.result !== undefined) {
        const resultLabel = document.createElement("div");
        resultLabel.className = "tool-section-label";
        resultLabel.textContent = tc.isError ? "错误" : "结果";
        body.appendChild(resultLabel);
        const resultPre = document.createElement("pre");
        if (tc.isError) resultPre.className = "error-output";
        resultPre.textContent = tc.result.slice(0, 2000);
        body.appendChild(resultPre);
      }

      card.appendChild(body);
      agentMessagesEl.appendChild(card);
    } else if (entry.type === "assistant") {
      const bubble = document.createElement("div");
      bubble.className = "msg msg-assistant";
      const role = document.createElement("span");
      role.className = "msg-role";
      role.textContent = "Agent";
      const body = document.createElement("div");
      body.className = "msg-body";
      body.textContent = entry.content;
      bubble.appendChild(role);
      bubble.appendChild(body);
      agentMessagesEl.appendChild(bubble);
    }
  }

  agentMessagesEl.scrollTop = agentMessagesEl.scrollHeight;
  setAgentStatus(agentPending ? "智能体执行中..." : "");
  updateAgentActionButton();
}

function handleAgentEvent(event: AgentProgressEvent): void {
  if (!activeAgentRequestId || event.payload.requestId !== activeAgentRequestId) {
    return;
  }

  if (event.type === "AGENT_TEXT_DELTA") {
    // Append to last assistant entry or create new
    const last = agentEntries[agentEntries.length - 1];
    if (last?.type === "assistant") {
      last.content += event.payload.delta;
    } else {
      agentEntries.push({ type: "assistant", content: event.payload.delta });
    }
    renderAgent();
    scheduleAgentPersist();
    return;
  }

  if (event.type === "AGENT_THINKING_DELTA") {
    const last = agentEntries[agentEntries.length - 1];
    if (last?.type === "thinking") {
      last.content += event.payload.delta;
    } else {
      agentEntries.push({ type: "thinking", content: event.payload.delta });
    }
    renderAgent();
    return;
  }

  if (event.type === "AGENT_TOOL_CALL") {
    const existing = agentEntries.find(
      (e) => e.type === "tool" && e.toolCall?.id === event.payload.toolCallId
    );
    if (existing && existing.toolCall) {
      existing.toolCall.arguments = event.payload.arguments;
    } else {
      agentEntries.push({
        type: "tool",
        content: "",
        toolCall: {
          id: event.payload.toolCallId,
          name: event.payload.name,
          arguments: event.payload.arguments,
          status: "running"
        }
      });
    }
    renderAgent();
    return;
  }

  if (event.type === "AGENT_TOOL_RESULT") {
    const entry = agentEntries.find(
      (e) => e.type === "tool" && e.toolCall?.id === event.payload.toolCallId
    );
    if (entry?.toolCall) {
      entry.toolCall.result = event.payload.result;
      entry.toolCall.isError = event.payload.isError;
      entry.toolCall.status = event.payload.isError ? "error" : "success";
    }
    renderAgent();
    scheduleAgentPersist();
    return;
  }

  if (event.type === "AGENT_ITERATION_START") {
    setAgentIterationInfo(`迭代 ${event.payload.iteration} / ${event.payload.maxIterations}`);
    return;
  }

  if (event.type === "AGENT_TURN_COMPLETE") {
    agentPending = false;
    activeAgentRequestId = null;
    setAgentIterationInfo(`完成 (${event.payload.iterations} 轮迭代)`);
    renderAgent();
    void persistActiveAgentSession();
    return;
  }

  if (event.type === "AGENT_ERROR") {
    agentPending = false;
    activeAgentRequestId = null;
    agentEntries.push({ type: "assistant", content: `⚠️ ${event.payload.error}` });
    renderAgent();
    void persistActiveAgentSession();
    return;
  }
}

function handleExternalAgentRunStarted(event: ExternalAgentRunStartedEvent): void {
  const existing = agentSessions.find((session) => session.id === event.payload.requestId);
  const now = Date.now();

  if (existing) {
    activeAgentSessionId = existing.id;
    agentEntries = (existing.entries ?? []).map((entry) => ({ ...entry }));
  } else {
    const session: AgentSession = {
      id: event.payload.requestId,
      title: event.payload.userMessage.slice(0, 30) || "外部命令",
      createdAt: event.payload.createdAt || now,
      updatedAt: now,
      messages: [],
      entries: [
        {
          type: "user",
          content: event.payload.userMessage
        }
      ]
    };
    agentSessions = [session, ...agentSessions.filter((s) => s.id !== session.id)];
    activeAgentSessionId = session.id;
    agentEntries = session.entries.map((entry) => ({ ...entry }));
  }

  activeAgentRequestId = event.payload.requestId;
  agentPending = true;
  setAgentIterationInfo("");
  activateTab("tabAgent");
  renderAgentSessions();
  renderAgent();
  scheduleAgentPersist();
}

function buildAgentHistoryMessages(entries: AgentEntry[]): AgentMessage[] {
  const history: AgentMessage[] = [];

  for (const entry of entries) {
    if (entry.type !== "user" && entry.type !== "assistant") {
      continue;
    }

    const content = entry.content.trim();
    if (!content) {
      continue;
    }

    history.push({
      role: entry.type,
      content
    });
  }

  return history;
}

async function sendAgentMessage(): Promise<void> {
  const input = agentInput.value.trim();
  agentInput.value = "";
  if (!input) return;

  const tabId = await getCurrentTabId();
  if (!tabId) {
    setAgentStatus("没有可用的标签页，智能体无法操作。");
    return;
  }

  const history = buildAgentHistoryMessages(agentEntries);
  agentEntries.push({ type: "user", content: input });
  agentPending = true;
  renderAgent();
  scheduleAgentPersist();

  const requestId = `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  activeAgentRequestId = requestId;
  setAgentIterationInfo("");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "AGENT_RUN",
      payload: {
        requestId,
        tabId,
        config: toAgentConfig(),
        userMessage: input,
        history,
        maxIterations: 100
      }
    });

    if (!response?.ok) {
      agentPending = false;
      activeAgentRequestId = null;
      agentEntries.push({
        type: "assistant",
        content: `Error: ${Array.isArray(response?.errors) ? response.errors.join(", ") : "Agent request failed"}`
      });
      renderAgent();
    }
  } catch (error) {
    agentPending = false;
    activeAgentRequestId = null;
    agentEntries.push({
      type: "assistant",
      content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`
    });
    renderAgent();
  }
}

async function stopAgent(): Promise<void> {
  if (!activeAgentRequestId) return;
  const requestId = activeAgentRequestId;
  activeAgentRequestId = null;
  agentPending = false;

  try {
    await chrome.runtime.sendMessage({
      type: "AGENT_CANCEL",
      payload: { requestId }
    });
  } catch {
    // ignored
  }

  renderAgent();
}

function clearAgent(): void {
  agentEntries = [];
  activeAgentRequestId = null;
  agentPending = false;
  setAgentIterationInfo("");
  renderAgent();
}

// ── Agent Session Management ──

function createAgentSessionTitle(): string {
  const firstUserEntry = agentEntries.find((e) => e.type === "user");
  if (firstUserEntry?.content) {
    return firstUserEntry.content.slice(0, 30);
  }
  return "新会话";
}

function ensureActiveAgentSession(): AgentSession {
  if (activeAgentSessionId) {
    const existing = agentSessions.find((s) => s.id === activeAgentSessionId);
    if (existing) return existing;
  }

  const now = Date.now();
  const created: AgentSession = {
    id: `agent-${now}-${Math.random().toString(16).slice(2)}`,
    title: "新会话",
    createdAt: now,
    updatedAt: now,
    messages: [],
    entries: []
  };

  agentSessions = [created, ...agentSessions];
  activeAgentSessionId = created.id;
  return created;
}

function renderAgentSessions(): void {
  agentSessionsEl.innerHTML = "";
  for (const session of agentSessions) {
    const btn = document.createElement("button");
    btn.className = `s-btn${session.id === activeAgentSessionId ? " active" : ""}`;
    btn.textContent = session.title;
    btn.title = new Date(session.updatedAt).toLocaleString();
    btn.addEventListener("click", () => {
      activeAgentSessionId = session.id;
      agentEntries = (session.entries ?? []).map((e) => ({ ...e }));
      activeAgentRequestId = null;
      agentPending = false;
      setAgentIterationInfo("");
      renderAgentSessions();
      renderAgent();
    });
    agentSessionsEl.appendChild(btn);
  }
}

function activateTab(targetId: string): void {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", (btn as HTMLButtonElement).dataset.tab === targetId);
  });
  document.querySelectorAll(".tab-content").forEach((panel) => {
    panel.classList.toggle("active", panel.id === targetId);
  });
}

function activateSettingsSubtab(targetId: string): void {
  activeSettingsSubtabId = targetId;
  settingsSubtabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.settingsTab === targetId);
  });
  settingsSubtabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === targetId);
  });
}

let agentPersistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAgentPersist(): void {
  if (agentPersistTimer) clearTimeout(agentPersistTimer);
  agentPersistTimer = setTimeout(() => {
    agentPersistTimer = null;
    void persistActiveAgentSession();
  }, 500);
}

async function persistActiveAgentSession(): Promise<void> {
  const session = ensureActiveAgentSession();
  const now = Date.now();
  const updated: AgentSession = {
    ...session,
    title: createAgentSessionTitle(),
    updatedAt: now,
    messages: buildAgentHistoryMessages(agentEntries),
    entries: agentEntries.map((e) => ({
      type: e.type,
      content: e.content,
      toolCall: e.toolCall ? { ...e.toolCall } : undefined
    }))
  };

  agentSessions = [updated, ...agentSessions.filter((s) => s.id !== updated.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
  renderAgentSessions();

  await chrome.runtime.sendMessage({
    type: "SAVE_AGENT_SESSION",
    payload: updated
  });
}

async function loadAgentSessions(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "GET_AGENT_SESSIONS" });
  if (!response?.ok || !Array.isArray(response?.data)) {
    agentSessions = [];
    activeAgentSessionId = null;
    renderAgentSessions();
    return;
  }

  agentSessions = response.data as AgentSession[];
  if (agentSessions.length > 0) {
    activeAgentSessionId = agentSessions[0].id;
    agentEntries = (agentSessions[0].entries ?? []).map((e) => ({ ...e }));
  } else {
    activeAgentSessionId = null;
    agentEntries = [];
  }

  renderAgentSessions();
  renderAgent();
}

function newAgentSession(): void {
  activeAgentSessionId = null;
  agentEntries = [];
  activeAgentRequestId = null;
  agentPending = false;
  setAgentIterationInfo("");
  ensureActiveAgentSession();
  renderAgentSessions();
  renderAgent();
}

async function deleteAgentSession(): Promise<void> {
  if (!activeAgentSessionId) return;
  const sessionId = activeAgentSessionId;

  agentSessions = agentSessions.filter((s) => s.id !== sessionId);
  if (agentSessions.length > 0) {
    activeAgentSessionId = agentSessions[0].id;
    agentEntries = (agentSessions[0].entries ?? []).map((e) => ({ ...e }));
  } else {
    activeAgentSessionId = null;
    agentEntries = [];
  }

  activeAgentRequestId = null;
  agentPending = false;
  setAgentIterationInfo("");
  renderAgentSessions();
  renderAgent();

  await chrome.runtime.sendMessage({
    type: "DELETE_AGENT_SESSION",
    payload: { sessionId }
  });
}

async function clearAgentSessions(): Promise<void> {
  agentSessions = [];
  activeAgentSessionId = null;
  agentEntries = [];
  activeAgentRequestId = null;
  agentPending = false;
  setAgentIterationInfo("");
  renderAgentSessions();
  renderAgent();

  await chrome.runtime.sendMessage({ type: "CLEAR_AGENT_SESSIONS" });
}

// ── Skills Panel ──

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  usageCount: number;
  tags: string[];
}

async function loadSkillsList(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "LIST_SKILLS" });
    if (!response?.ok) {
      skillsListEl.innerHTML = '<div style="padding:8px;color:#991b1b;font-size:11px;">加载技能失败</div>';
      return;
    }
    const skills = (response.data ?? []) as SkillSummary[];
    renderSkillsList(skills);
  } catch {
    skillsListEl.innerHTML = '<div style="padding:8px;color:#991b1b;font-size:11px;">加载技能失败</div>';
  }
}

function renderSkillsList(skills: SkillSummary[]): void {
  skillsListEl.innerHTML = "";
  if (skills.length === 0) return; // CSS :empty pseudo handles empty state

  for (const skill of skills) {
    const item = document.createElement("div");
    item.className = "skill-item";

    const nameEl = document.createElement("span");
    nameEl.className = "skill-name";
    nameEl.textContent = skill.name;
    nameEl.title = skill.description;

    const metaEl = document.createElement("span");
    metaEl.className = "skill-meta";
    metaEl.textContent = `v${skill.version}${skill.usageCount > 0 ? ` · ${skill.usageCount}次` : ""}`;

    const runBtn = document.createElement("button");
    runBtn.className = "skill-run-btn";
    runBtn.textContent = "执行";
    runBtn.addEventListener("click", () => {
      agentInput.value = `执行技能「${skill.name}」(id: ${skill.id})`;
      void sendAgentMessage();
    });

    const editBtn = document.createElement("button");
    editBtn.className = "skill-edit-btn";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => {
      void openSkillEditor(skill.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "skill-delete-btn";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", () => {
      void deleteSkillDirect(skill.id, skill.name);
    });

    item.appendChild(nameEl);
    item.appendChild(metaEl);
    item.appendChild(runBtn);
    item.appendChild(editBtn);
    item.appendChild(deleteBtn);
    skillsListEl.appendChild(item);
  }
}

// ── Skill Edit Modal ──

interface SkillDetail {
  id: string;
  name: string;
  description: string;
  steps: Array<{ instruction: string }>;
  tags: string[];
  version: number;
}

async function openSkillEditor(skillId: string): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SKILL", payload: { skillId } });
    if (!response?.ok || !response.data) {
      alert("加载技能详情失败");
      return;
    }
    const skill = response.data as SkillDetail;
    showSkillEditModal(skill);
  } catch {
    alert("加载技能详情失败");
  }
}

function showSkillEditModal(skill: SkillDetail): void {
  // Remove any existing modal
  document.querySelector(".skill-modal-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "skill-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "skill-modal";

  modal.innerHTML = `
    <h3>编辑技能 (v${skill.version})</h3>
    <label>Markdown 格式编辑</label>
    <textarea id="editSkillMarkdown" rows="14" style="font-family:monospace;font-size:12px;"></textarea>
    <div class="modal-actions">
      <button class="btn-secondary" id="editSkillCancel">取消</button>
      <button class="btn-primary" id="editSkillSave">保存</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Convert skill to Markdown and populate
  const md = skillToMarkdown({
    name: skill.name,
    description: skill.description,
    steps: skill.steps,
    tags: skill.tags
  });
  (document.getElementById("editSkillMarkdown") as HTMLTextAreaElement).value = md;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.getElementById("editSkillCancel")!.addEventListener("click", () => {
    overlay.remove();
  });

  document.getElementById("editSkillSave")!.addEventListener("click", () => {
    void saveSkillEdit(skill.id, overlay);
  });
}

async function saveSkillEdit(skillId: string, overlay: HTMLElement): Promise<void> {
  const mdText = (document.getElementById("editSkillMarkdown") as HTMLTextAreaElement).value;
  const parsed = parseSkillMarkdown(mdText);

  if (!parsed) {
    alert("Markdown 格式无效，需要包含 # 名称 和 ## Steps 部分");
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "UPDATE_SKILL_DIRECT",
      payload: { skillId, name: parsed.name, description: parsed.description, steps: parsed.steps, tags: parsed.tags }
    });
    if (!response?.ok) {
      alert("保存失败: " + (response?.errors?.[0] ?? "未知错误"));
      return;
    }
    overlay.remove();
    void loadSkillsList();
  } catch {
    alert("保存失败");
  }
}

async function deleteSkillDirect(skillId: string, skillName: string): Promise<void> {
  if (!confirm(`确定删除技能「${skillName}」？`)) return;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "DELETE_SKILL_DIRECT",
      payload: { skillId }
    });
    if (!response?.ok) {
      alert("删除失败");
      return;
    }
    void loadSkillsList();
  } catch {
    alert("删除失败");
  }
}

// ── Skill Import / Export ──

async function importSkillsFromFile(): Promise<void> {
  skillImportFileEl.value = "";
  skillImportFileEl.click();
}

skillImportFileEl.addEventListener("change", () => {
  const file = skillImportFileEl.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const text = reader.result as string;
      let skills: Array<{ name: string; description: string; steps: string[]; tags?: string[] }>;

      // Try Markdown format first, then fall back to JSON
      const mdSkills = parseSkillsMarkdown(text);
      if (mdSkills.length > 0) {
        skills = mdSkills;
      } else {
        // Fallback: try JSON
        try {
          const parsed = JSON.parse(text);
          const jsonSkills = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.skills) ? parsed.skills : null);
          if (!jsonSkills) {
            alert("无效的技能文件格式，需要 Markdown 格式或 JSON 数组");
            return;
          }
          skills = jsonSkills;
        } catch {
          alert("文件解析失败，请确保是有效的 Markdown 或 JSON 文件");
          return;
        }
      }

      const response = await chrome.runtime.sendMessage({
        type: "IMPORT_SKILLS",
        payload: { skills }
      });
      if (!response?.ok) {
        alert("导入失败: " + (response?.errors?.[0] ?? "未知错误"));
        return;
      }
      const data = response.data as { imported: unknown[]; skipped: string[] };
      const msg = `成功导入 ${data.imported.length} 个技能` +
        (data.skipped.length > 0 ? `，跳过 ${data.skipped.length} 个（已存在或无效）` : "");
      alert(msg);
      void loadSkillsList();
    } catch {
      alert("文件解析失败");
    }
  };
  reader.readAsText(file);
});

async function exportSkillsToFile(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "LIST_SKILLS" });
    if (!response?.ok) {
      alert("导出失败");
      return;
    }

    // Fetch full details for each skill to include steps
    const summaries = (response.data ?? []) as SkillSummary[];
    const fullSkills: SkillDetail[] = [];
    for (const s of summaries) {
      const detailResp = await chrome.runtime.sendMessage({ type: "GET_SKILL", payload: { skillId: s.id } });
      if (detailResp?.ok && detailResp.data) {
        fullSkills.push(detailResp.data as SkillDetail);
      }
    }

    const exportData = fullSkills.map((s) => ({
      name: s.name,
      description: s.description,
      steps: s.steps,
      tags: s.tags
    }));

    const mdContent = skillsToMarkdown(exportData);
    const blob = new Blob([mdContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neonagent-skills-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    alert("导出失败");
  }
}

// ── Memory Panel ──

interface MemorySummary {
  id: string;
  content: string;
  tags: string[];
}

async function loadMemoriesList(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "LIST_MEMORIES" });
    if (!response?.ok) {
      memoriesListEl.innerHTML = '<div style="padding:8px;color:#991b1b;font-size:11px;">加载记忆失败</div>';
      return;
    }
    const memories = (response.data ?? []) as MemorySummary[];
    renderMemoriesList(memories);
  } catch {
    memoriesListEl.innerHTML = '<div style="padding:8px;color:#991b1b;font-size:11px;">加载记忆失败</div>';
  }
}

function renderMemoriesList(memories: MemorySummary[]): void {
  memoriesListEl.innerHTML = "";
  if (memories.length === 0) {
    memoriesListEl.innerHTML = '<div style="padding:8px;color:#94a3b8;font-size:11px;text-align:center;">暂无记忆条目</div>';
    return;
  }

  const countEl = document.createElement("div");
  countEl.style.cssText = "padding:4px 4px 2px;font-size:10px;color:#94a3b8;";
  countEl.textContent = `共 ${memories.length} 条记忆`;
  memoriesListEl.appendChild(countEl);

  for (const mem of memories) {
    const item = document.createElement("div");
    item.className = "skill-item";

    const contentEl = document.createElement("span");
    contentEl.className = "skill-name";
    contentEl.textContent = mem.content;
    contentEl.title = mem.content;

    const tagEl = document.createElement("span");
    tagEl.className = "skill-meta";
    tagEl.textContent = mem.tags.length > 0 ? mem.tags.join(", ") : "";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "skill-delete-btn";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", () => {
      void deleteMemoryDirect(mem.id);
    });

    item.appendChild(contentEl);
    item.appendChild(tagEl);
    item.appendChild(deleteBtn);
    memoriesListEl.appendChild(item);
  }
}

async function deleteMemoryDirect(memoryId: string): Promise<void> {
  if (!confirm("确定删除该记忆？")) return;
  try {
    await chrome.runtime.sendMessage({ type: "DELETE_MEMORY_DIRECT", payload: { memoryId } });
    void loadMemoriesList();
  } catch {
    alert("删除失败");
  }
}

async function importMemoriesFromFile(): Promise<void> {
  memoryImportFileEl.value = "";
  memoryImportFileEl.click();
}

memoryImportFileEl.addEventListener("change", () => {
  const file = memoryImportFileEl.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const text = reader.result as string;
      let memories: Array<{ content: string; tags?: string[] }>;

      // Try Markdown format first
      const mdMemories = parseMemoriesMarkdown(text);
      if (mdMemories.length > 0) {
        memories = mdMemories;
      } else {
        // Fallback: try JSON
        try {
          const parsed = JSON.parse(text);
          const jsonMemories = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.memories) ? parsed.memories : null);
          if (!jsonMemories) {
            alert("无效的记忆文件格式，需要 Markdown 格式或 JSON 数组");
            return;
          }
          memories = jsonMemories;
        } catch {
          alert("文件解析失败，请确保是有效的 Markdown 或 JSON 文件");
          return;
        }
      }

      const response = await chrome.runtime.sendMessage({
        type: "IMPORT_MEMORIES",
        payload: { memories }
      });
      if (!response?.ok) {
        alert("导入失败: " + (response?.errors?.[0] ?? "未知错误"));
        return;
      }
      const data = response.data as { imported: unknown[]; skipped: number };
      const msg = `成功导入 ${data.imported.length} 条记忆` +
        (data.skipped > 0 ? `，跳过 ${data.skipped} 条（重复）` : "");
      alert(msg);
      void loadMemoriesList();
    } catch {
      alert("文件解析失败");
    }
  };
  reader.readAsText(file);
});

async function exportMemoriesToFile(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "LIST_MEMORIES" });
    if (!response?.ok) {
      alert("导出失败");
      return;
    }
    const memories = (response.data ?? []) as Array<{ id: string; content: string; tags: string[]; createdAt: number; updatedAt: number }>;
    const mdContent = memoriesToMarkdown(memories);
    const blob = new Blob([mdContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neonagent-memories-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    alert("导出失败");
  }
}

async function compressMemoriesAction(): Promise<void> {
  if (!confirm("将调用 LLM 对记忆进行智能压缩合并，是否继续？")) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "COMPRESS_MEMORIES" });
    if (!response?.ok) {
      alert("压缩失败: " + (response?.errors?.[0] ?? "未知错误"));
      return;
    }
    const data = response.data as { originalCount: number; compressedCount: number; skipped?: boolean };
    if (data.skipped) {
      alert(`当前仅 ${data.originalCount} 条记忆，无需压缩`);
    } else {
      alert(`压缩完成：${data.originalCount} → ${data.compressedCount} 条`);
    }
    void loadMemoriesList();
  } catch {
    alert("压缩失败");
  }
}

// ── Scheduled Tasks Panel ──

interface TaskSummary {
  id: string;
  name: string;
  instruction: string;
  scheduleType: string;
  time: string;
  dayOfWeek?: number;
  intervalMinutes?: number;
  enabled: boolean;
  lastRunAt: number | null;
  runCount: number;
}

async function loadTasksList(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "LIST_SCHEDULED_TASKS" });
    if (!response?.ok) {
      tasksListEl.innerHTML = '<div style="padding:8px;color:#991b1b;font-size:11px;">加载任务失败</div>';
      return;
    }
    const tasks = (response.data ?? []) as TaskSummary[];
    renderTasksList(tasks);
  } catch {
    tasksListEl.innerHTML = '<div style="padding:8px;color:#991b1b;font-size:11px;">加载任务失败</div>';
  }
}

function describeScheduleUI(task: TaskSummary): string {
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  switch (task.scheduleType) {
    case "once": return `单次 ${task.time}`;
    case "interval": return `每${task.intervalMinutes}分钟`;
    case "daily": return `每天 ${task.time}`;
    case "weekly": return `每${days[task.dayOfWeek ?? 0]} ${task.time}`;
    default: return task.scheduleType;
  }
}

function renderTasksList(tasks: TaskSummary[]): void {
  tasksListEl.innerHTML = "";
  if (tasks.length === 0) return;

  for (const task of tasks) {
    const item = document.createElement("div");
    item.className = "task-item";

    const statusIcon = document.createElement("span");
    statusIcon.className = "task-status-icon";
    statusIcon.textContent = task.enabled ? "✅" : "⏸️";
    statusIcon.title = task.enabled ? "运行中" : "已暂停";

    const nameEl = document.createElement("span");
    nameEl.className = "task-name";
    nameEl.textContent = task.name;
    nameEl.title = task.instruction;

    const scheduleEl = document.createElement("span");
    scheduleEl.className = "task-schedule";
    scheduleEl.textContent = `${describeScheduleUI(task)}${task.runCount > 0 ? ` · ${task.runCount}次` : ""}`;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = `task-toggle-btn ${task.enabled ? "enabled" : "disabled"}`;
    toggleBtn.textContent = task.enabled ? "暂停" : "恢复";
    toggleBtn.addEventListener("click", () => {
      agentInput.value = task.enabled
        ? `暂停定时任务「${task.name}」(id: ${task.id})`
        : `恢复定时任务「${task.name}」(id: ${task.id})`;
      void sendAgentMessage();
    });

    item.appendChild(statusIcon);
    item.appendChild(nameEl);
    item.appendChild(scheduleEl);
    item.appendChild(toggleBtn);
    tasksListEl.appendChild(item);
  }
}

function isAgentEvent(type: string): boolean {
  return (
    type === "AGENT_TEXT_DELTA" ||
    type === "AGENT_THINKING_DELTA" ||
    type === "AGENT_TOOL_CALL" ||
    type === "AGENT_TOOL_RESULT" ||
    type === "AGENT_ITERATION_START" ||
    type === "AGENT_TURN_COMPLETE" ||
    type === "AGENT_ERROR"
  );
}

function maybeHandleRuntimeMessage(message: unknown): void {
  if (
    typeof message !== "object" ||
    message === null ||
    typeof (message as { type?: unknown }).type !== "string"
  ) {
    return;
  }

  const type = (message as { type: string }).type;

  if (type === "LLM_STREAM_CHUNK" || type === "LLM_STREAM_DONE" || type === "LLM_STREAM_ERROR") {
    handleStreamEvent(message as RuntimeStreamEvent);
    return;
  }

  if (type === "AGENT_EXTERNAL_RUN_STARTED") {
    handleExternalAgentRunStarted(message as ExternalAgentRunStartedEvent);
    return;
  }

  if (type === "AUTO_SOLVE_CURRENT_PAGE_REQUESTED") {
    void handleAutoSolveCurrentPageRequest(message as AutoSolveCurrentPageRequestedEvent);
    return;
  }

  if (isAgentEvent(type)) {
    handleAgentEvent(message as AgentProgressEvent);
    return;
  }
}

byId<HTMLButtonElement>("saveConfig").addEventListener("click", () => {
  const configuredProvider = materializeTemplateProvider(getFormApiProvider());
  if (configuredProvider) {
    activeApiProviderId = configuredProvider.id;
    formApiProviderId = configuredProvider.id;
    applyApiProviderToForm(configuredProvider);
    renderApiProviderTabs();
    renderApiProviderList();
  }
  void saveConfig("Config saved", true);
});

byId<HTMLButtonElement>("testLlmConfig").addEventListener("click", () => {
  void testLlmConfig();
});

apiKeyVisibilityBtn.addEventListener("click", () => {
  apiKeyVisible = !apiKeyVisible;
  updateApiKeyVisibilityButton();
});

apiConfigEditTabBtn.addEventListener("click", () => {
  activateApiConfigSubtab("apiConfigEditPanel");
});

apiConfigListTabBtn.addEventListener("click", () => {
  activateApiConfigSubtab("apiConfigListPanel");
});

baseUrlInput.addEventListener("input", () => {
  syncActiveApiProviderBaseUrl(baseUrlInput.value);
});

apiKeyInput.addEventListener("input", () => {
  const provider = getFormApiProvider();
  if (provider) {
    provider.apiKey = apiKeyInput.value;
    refreshApiProviderListIfVisible();
  }
});

modelInput.addEventListener("change", () => {
  chatModelInput.value = modelInput.value;
  agentModelInput.value = modelInput.value;
  syncActiveApiProviderModels(modelInput.value);
});

refreshLocalCommandStatusBtn.addEventListener("click", () => {
  void refreshLocalCommandStatus();
});

autoSolveCurrentPageInput.addEventListener("change", () => {
  void handleFeatureSwitchChange({ refreshAutoSolve: true });
});

[
  localCommandEnabledInput,
  unlockContextMenuInput,
  blockVisibilityDetectionInput,
  aggressiveVisibilityBypassInput,
  blockFullscreenRequestsInput
].forEach((input) => {
  input.addEventListener("change", () => {
    void handleFeatureSwitchChange();
  });
});

addModelBtn.addEventListener("click", () => {
  const name = newModelInput.value.trim();
  if (!name) return;
  if (currentModels.includes(name)) {
    setStatus("模型已存在", true);
    return;
  }
  currentModels.push(name);
  newModelInput.value = "";
  renderModelSelect(name, name, name);
  syncActiveApiProviderModels(name);
});

removeModelBtn.addEventListener("click", () => {
  const selected = modelInput.value;
  if (!selected) return;
  if (currentModels.length <= 1) {
    setStatus("至少保留一个模型", true);
    return;
  }
  const selectedChatModel = chatModelInput.value;
  const selectedAgentModel = agentModelInput.value;
  currentModels = currentModels.filter((m) => m !== selected);
  renderModelSelect(
    undefined,
    selectedChatModel === selected ? undefined : selectedChatModel,
    selectedAgentModel === selected ? undefined : selectedAgentModel
  );
  syncActiveApiProviderModels(modelInput.value);
});

byId<HTMLButtonElement>("exportConfig").addEventListener("click", () => {
  void exportConfig();
});

byId<HTMLButtonElement>("importConfigBtn").addEventListener("click", () => {
  triggerImportConfig();
});

byId<HTMLButtonElement>("applyTranslation").addEventListener("click", () => {
  void applyTranslationToActiveTab();
});

[
  translationEnabledInput,
  selectionTranslationEnabledInput,
  translationStyleBoldInput,
  translationStyleItalicInput
].forEach((input) => {
  input.addEventListener("change", () => {
    void applyTranslationToActiveTab();
  });
});

byId<HTMLButtonElement>("translateCurrentPage").addEventListener("click", () => {
  void translateCurrentPage();
});

byId<HTMLButtonElement>("clearTranslation").addEventListener("click", () => {
  void clearTranslationsFromActiveTab();
});

byId<HTMLButtonElement>("loadContext").addEventListener("click", () => {
  void loadPageContext();
});

chatActionBtn.addEventListener("click", () => {
  if (chatState.pending || activeStreamRequestId) {
    void stopChatMessage();
    return;
  }
  void sendChatMessage();
});

byId<HTMLButtonElement>("askAndAutoFill").addEventListener("click", () => {
  void askAndAutoFill();
});

byId<HTMLButtonElement>("newChat").addEventListener("click", () => {
  void createNewChat();
});

byId<HTMLButtonElement>("deleteChat").addEventListener("click", () => {
  void deleteCurrentChat();
});

byId<HTMLButtonElement>("clearChats").addEventListener("click", () => {
  void clearAllChats();
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void sendChatMessage();
  }
});

// Agent event listeners
agentActionBtn.addEventListener("click", () => {
  if (agentPending || activeAgentRequestId) {
    void stopAgent();
    return;
  }
  void sendAgentMessage();
});

byId<HTMLButtonElement>("newAgent").addEventListener("click", () => {
  newAgentSession();
});

byId<HTMLButtonElement>("deleteAgent").addEventListener("click", () => {
  void deleteAgentSession();
});

byId<HTMLButtonElement>("clearAgentSessions").addEventListener("click", () => {
  void clearAgentSessions();
});

toggleMemoriesBtn.addEventListener("click", () => {
  const next = activeAgentPanel === "memories" ? null : "memories";
  showAgentPanel(next);
  if (next === "memories") void loadMemoriesList();
});

byId<HTMLButtonElement>("refreshMemories").addEventListener("click", () => {
  void loadMemoriesList();
});

byId<HTMLButtonElement>("importMemories").addEventListener("click", () => {
  void importMemoriesFromFile();
});

byId<HTMLButtonElement>("exportMemories").addEventListener("click", () => {
  void exportMemoriesToFile();
});

byId<HTMLButtonElement>("compressMemories").addEventListener("click", () => {
  void compressMemoriesAction();
});

toggleSkillsBtn.addEventListener("click", () => {
  const next = activeAgentPanel === "skills" ? null : "skills";
  showAgentPanel(next);
  if (next === "skills") void loadSkillsList();
});

byId<HTMLButtonElement>("refreshSkills").addEventListener("click", () => {
  void loadSkillsList();
});

byId<HTMLButtonElement>("importSkills").addEventListener("click", () => {
  void importSkillsFromFile();
});

byId<HTMLButtonElement>("exportSkills").addEventListener("click", () => {
  void exportSkillsToFile();
});

toggleTasksBtn.addEventListener("click", () => {
  const next = activeAgentPanel === "tasks" ? null : "tasks";
  showAgentPanel(next);
  if (next === "tasks") void loadTasksList();
});

byId<HTMLButtonElement>("refreshTasks").addEventListener("click", () => {
  void loadTasksList();
});

agentInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void sendAgentMessage();
  }
});

// Tab switching
document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.tab;
    if (!targetId) {
      return;
    }

    activateTab(targetId);
    if (targetId === "tabChat") {
      void refreshAutoSolveDetectionStatus({ solveWhenDetected: true });
    } else if (targetId === "tabSettings") {
      activateSettingsSubtab(activeSettingsSubtabId);
    }
  });
});

settingsSubtabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.settingsTab;
    if (!targetId) {
      return;
    }

    activateSettingsSubtab(targetId);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  maybeHandleRuntimeMessage(message);
});

activateApiConfigSubtab("apiConfigListPanel");
setActiveApiProvider(activeApiProviderId);
void loadConfig();
updateApiKeyVisibilityButton();
void loadChatSessions();
void loadAgentSessions();
setTimeout(() => {
  void (async () => {
    const handledPending = await loadPendingAutoSolveRequest();
    if (!handledPending) {
      await refreshAutoSolveDetectionStatus({ solveWhenDetected: true });
    }
  })();
}, 300);
