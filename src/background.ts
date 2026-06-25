import { DEFAULT_CONFIG, validateConfig } from "./shared/config.js";
import { chromeStorageAdapter } from "./shared/chromeStorageAdapter.js";
import { ChatHistoryRepository, ConfigRepository, AgentHistoryRepository, XBlockedAccountRepository, SiteActionMemoryRepository } from "./shared/storage.js";
import { isRuntimeMessage } from "./shared/messageGuards.js";
import {
  requestChatCompletion,
  requestChatCompletionStream,
  requestVisionChatCompletion
} from "./shared/llmClient.js";
import { runAgentLoop } from "./shared/agentLoop.js";
import type { AgentProgressEvent, AgentRunConfig, AgentSession, ToolResult } from "./shared/agentTypes.js";
import type { ChatSession, LLMConfig, XBlockedAccountRecord } from "./shared/types.js";
import type { RuntimeStreamEvent } from "./shared/types.js";
import type { StorageLike } from "./shared/storage.js";
import { addMemory, searchMemories, deleteMemory, getAllMemories, importMemories, compressMemories, needsCompression } from "./shared/agentMemory.js";
import {
  createSkill, listSkills, executeSkill, updateSkill, deleteSkill,
  getAllSkills, getSkillById, importSkills, formatSkillForExecution
} from "./shared/agentSkills.js";
import type { SkillStep } from "./shared/agentSkills.js";
import {
  createScheduledTask, listScheduledTasks, updateScheduledTask,
  deleteScheduledTask, getScheduledTask, recordTaskRun,
  getAllScheduledTasks, computeAlarmParams, getAlarmName, parseAlarmName
} from "./shared/agentScheduler.js";
import {
  getAllScriptSkills, createScriptSkill, updateScriptSkill,
  deleteScriptSkill, listScriptSkills, findScriptSkillByToolName,
  recordScriptSkillUsage
} from "./shared/agentScriptSkill.js";
import type { ScriptSkillToolDef } from "./shared/agentScriptSkill.js";
import { BACKGROUND_TOOLS, PAGE_TOOLS } from "./shared/agentTools.js";

interface BackgroundDependencies {
  invokeLLM?: typeof requestChatCompletion;
  invokeLLMStream?: typeof requestChatCompletionStream;
  runAgent?: typeof runAgentLoop;
  emitStreamEvent?: (event: RuntimeStreamEvent) => void | Promise<void>;
  emitAgentEvent?: (event: AgentProgressEvent) => void | Promise<void>;
  sendTabMessage?: (tabId: number, message: unknown) => Promise<unknown>;
  /** Override sandbox execution for testing (bypasses offscreen document) */
  executeInSandbox?: (code: string, toolName: string, args: Record<string, unknown>, envVars: Record<string, string>) => Promise<string>;
}

const TRANSLATION_CACHE_KEY = "neonagent.translationCache";
const WORD_LOOKUP_CACHE_KEY = "neonagent.wordLookupCache";
const AUTO_SOLVE_HANDLED_KEY = "neonagent.autoSolveHandled";

type TranslationCache = Record<string, {
  translatedText: string;
  updatedAt: number;
}>;

type WordLookupDetails = {
  translation: string;
  pronunciation: string;
  partOfSpeech: string;
};

type WordLookupCache = Record<string, WordLookupDetails & {
  updatedAt: number;
}>;

type XAccountRiskDecision = {
  decision: "block" | "skip" | "unknown";
  category: "adult" | "marketing" | "normal" | "unknown";
  confidence: number;
  reason: string;
};

interface AgentExternalCommandPayload {
  requestId?: string;
  tabId?: number;
  userMessage?: string;
  config?: LLMConfig;
  history?: AgentRunConfig["history"];
  maxIterations?: number;
  toolTimeout?: number;
}

interface AgentExternalToolCallPayload {
  requestId?: string;
  tabId?: number;
  toolName?: string;
  arguments?: Record<string, unknown>;
  config?: LLMConfig;
}

interface AgentExternalGetResultPayload {
  requestId?: string;
}

interface LocalCommandEnvelope {
  type?: string;
  requestId?: string;
  token?: string;
  tabId?: number;
  userMessage?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  skillId?: string;
  stopOnError?: boolean;
  waitForResult?: boolean;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  maxIterations?: number;
  toolTimeout?: number;
  config?: LLMConfig;
  history?: AgentRunConfig["history"];
}

type ExternalAgentRunStatus = "running" | "completed" | "error";

interface ExternalAgentToolCallState {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  isError?: boolean;
  status: "running" | "success" | "error";
}

interface ExternalAgentRunState {
  requestId: string;
  senderId: string;
  tabId: number;
  userMessage: string;
  status: ExternalAgentRunStatus;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  iterations?: number;
  assistantText: string;
  thinkingText: string;
  error?: string;
  toolCalls: ExternalAgentToolCallState[];
}

// ── Offscreen / Sandbox helpers ──

async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.offscreen) return;
  try {
    await (chrome.offscreen as any).createDocument({
      url: "offscreen.html",
      reasons: ["IFRAME_SCRIPTING"],
      justification: "Sandboxed script skill execution"
    });
  } catch {
    // Already exists — ignore
  }
}

async function executeScriptInSandbox(
  code: string,
  toolName: string,
  args: Record<string, unknown>,
  envVars: Record<string, string>
): Promise<string> {
  await ensureOffscreenDocument();
  const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await chrome.runtime.sendMessage({
    type: "SANDBOX_EXECUTE",
    execId,
    code,
    toolName,
    args,
    envVars
  }) as { ok: boolean; result?: string; error?: string };
  if (!response?.ok) {
    throw new Error(response?.error ?? "Sandbox execution failed");
  }
  return response.result ?? "";
}

function buildTranslationCacheKey(targetLanguage: string, text: string): string {
  return `${targetLanguage.trim()}::${text}`;
}

function buildWordLookupCacheKey(targetLanguage: string, text: string): string {
  return `${targetLanguage.trim()}::${text.trim().toLowerCase()}`;
}

async function getTranslationCache(storage: StorageLike): Promise<TranslationCache> {
  const cache = await storage.get<TranslationCache>(TRANSLATION_CACHE_KEY);
  return cache && typeof cache === "object" ? cache : {};
}

async function saveTranslationCache(storage: StorageLike, cache: TranslationCache): Promise<void> {
  await storage.set(TRANSLATION_CACHE_KEY, cache);
}

async function getWordLookupCache(storage: StorageLike): Promise<WordLookupCache> {
  const cache = await storage.get<WordLookupCache>(WORD_LOOKUP_CACHE_KEY);
  return cache && typeof cache === "object" ? cache : {};
}

async function saveWordLookupCache(storage: StorageLike, cache: WordLookupCache): Promise<void> {
  await storage.set(WORD_LOOKUP_CACHE_KEY, cache);
}

function buildTranslationPrompt(targetLanguage: string, segments: string[]): string {
  return [
    `Translate each text segment into ${targetLanguage}.`,
    "Keep the meaning, tone, and paragraph boundaries natural.",
    "Return strict JSON only with this shape:",
    '{"translations":["translated text 1","translated text 2"]}',
    "Do not include markdown fences, comments, or explanations.",
    JSON.stringify({ segments })
  ].join("\n");
}

function buildStreamingTranslationPrompt(targetLanguage: string, text: string): string {
  return [
    `Translate SOURCE_TEXT into ${targetLanguage}.`,
    "SOURCE_TEXT may be a single word, a short phrase, a sentence, or a paragraph. Always translate the provided SOURCE_TEXT directly.",
    "Keep the meaning, tone, punctuation, and inline formatting natural.",
    "Return only the translated text itself. Do not include labels such as Translation/译文/翻译结果, quotes, JSON, markdown fences, comments, source text, or explanations.",
    "SOURCE_TEXT:",
    "```text",
    text,
    "```",
    "Translate the exact SOURCE_TEXT above."
  ].join("\n\n");
}

function isThinkingModelName(model: string): boolean {
  return /\b(?:thinking|reasoner|reasoning)\b/i.test(model.trim());
}

function getModelFamilyToken(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return "";
  const slashPart = normalized.split("/").find(Boolean);
  const firstPart = (slashPart ?? normalized).split(/[-_]/).find(Boolean);
  return firstPart ?? "";
}

function resolveTranslationModelName(config: LLMConfig): string {
  const requestedModel = typeof config.translationModel === "string" && config.translationModel.trim()
    ? config.translationModel.trim()
    : config.model.trim();

  if (!requestedModel || !isThinkingModelName(requestedModel)) {
    return requestedModel;
  }

  const models = Array.isArray(config.models)
    ? config.models
      .map((model) => (typeof model === "string" ? model.trim() : ""))
      .filter(Boolean)
    : [];
  const familyToken = getModelFamilyToken(requestedModel);

  const sameFamilyCandidate = models.find((model) => (
    !isThinkingModelName(model) &&
    familyToken &&
    getModelFamilyToken(model) === familyToken
  ));
  if (sameFamilyCandidate) {
    return sameFamilyCandidate;
  }

  const fallbackCandidate = models.find((model) => !isThinkingModelName(model));
  return fallbackCandidate ?? requestedModel;
}

function getTranslationRequestConfig(config: LLMConfig): LLMConfig {
  const resolvedModel = resolveTranslationModelName(config);
  if (!resolvedModel) return config;

  const models = Array.isArray(config.models) && config.models.length > 0
    ? config.models
    : [config.model];

  return {
    ...config,
    model: resolvedModel,
    models: models.includes(resolvedModel) ? models : [resolvedModel, ...models]
  };
}

function getTranslationRequestBodyExtras(config: LLMConfig): Record<string, unknown> | undefined {
  const model = config.model.trim();
  if (/^minimax-m3$/i.test(model)) {
    return {
      thinking: { type: "disabled" },
      reasoning_split: true
    };
  }
  if (/^deepseek-v4$/i.test(model)) {
    return { reasoning_effort: "" };
  }
  if (/qwen/i.test(model)) {
    return { enable_thinking: false };
  }
  if (
    /deepseek/i.test(model) ||
    /^ds-v4-(?:flash|pro)$/i.test(model) ||
    /^kimi-k2\.(?:5|6)$/i.test(model)
  ) {
    return { thinking: { type: "disabled" } };
  }
  return undefined;
}

function getChatThinkingRequestBodyExtras(
  config: LLMConfig,
  thinkingEnabled: boolean | undefined
): Record<string, unknown> | undefined {
  const model = config.model.trim();
  if (/^minimax-m3$/i.test(model)) {
    return {
      thinking: {
        type: thinkingEnabled === false ? "disabled" : "adaptive"
      },
      reasoning_split: true
    };
  }
  if (/^deepseek-v4$/i.test(model)) {
    return {
      reasoning_effort: thinkingEnabled === false ? "" : "high"
    };
  }

  if (thinkingEnabled !== false) {
    return undefined;
  }

  return getTranslationRequestBodyExtras(config);
}

function buildWordLookupPrompt(targetLanguage: string, text: string): string {
  return [
    `Analyze SOURCE_WORD and explain it for a learner in ${targetLanguage}.`,
    "SOURCE_WORD is usually a single English word selected from a webpage.",
    "Return strict JSON only with this shape:",
    '{"translation":"简洁释义","pronunciation":"音标或读音","partOfSpeech":"词性"}',
    "Keep translation concise and natural.",
    "Use pronunciation as IPA when possible.",
    "Use partOfSpeech such as n., v., adj., adv., prep., pron., etc.",
    "If a field is unavailable, return an empty string for that field.",
    "Do not include markdown fences, comments, or explanations.",
    "SOURCE_WORD:",
    "```text",
    text,
    "```"
  ].join("\n\n");
}

function stripJsonFences(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseWordLookupResponse(content: string): WordLookupDetails {
  const trimmed = stripJsonFences(content);
  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Word lookup response is not valid JSON");
  }

  const record = typeof parsed === "object" && parsed !== null
    ? parsed as Record<string, unknown>
    : null;

  const translation = typeof record?.translation === "string"
    ? record.translation.trim()
    : typeof record?.meaning === "string"
      ? String(record.meaning).trim()
      : "";
  const pronunciation = typeof record?.pronunciation === "string"
    ? record.pronunciation.trim()
    : typeof record?.phonetic === "string"
      ? String(record.phonetic).trim()
      : "";
  const partOfSpeech = typeof record?.partOfSpeech === "string"
    ? record.partOfSpeech.trim()
    : typeof record?.pos === "string"
      ? String(record.pos).trim()
      : "";

  if (!translation) {
    throw new Error("Word lookup response missing translation");
  }

  return {
    translation,
    pronunciation,
    partOfSpeech
  };
}

function buildXAccountRiskPrompt(input: {
  handle: string;
  displayName: string;
  snippet: string;
  localReason: string;
}): string {
  return [
    "You are reviewing whether an X.com account should be auto-blocked as spam/adult content.",
    "Return strict JSON only with this shape:",
    '{"decision":"block|skip|unknown","category":"adult|marketing|normal|unknown","confidence":0.0,"reason":"short reason"}',
    "Rules:",
    '1. Return "block" only when the text clearly looks like色情招嫖/约炮引流/营销引流/诈骗式导流/明显垃圾营销。',
    '2. Return "skip" when the text looks normal, ambiguous, joke-only, or evidence is weak.',
    '3. Return "unknown" when there is not enough information.',
    '4. confidence must be a number between 0 and 1.',
    '5. reason must be short and plain text, no markdown.',
    "Signals that strongly support block include:",
    "- inviting users to view homepage/profile/avatar for hookups or contact info",
    "- nearby/friends/meetup/real reliable/no套路/约见/免费/处男/福利/线下/骚货 style solicitation",
    "- telegram/tg/whatsapp/wechat/onlyfans/contact diversion",
    "- repeated emoji-grid or noise text combined with a sexual or marketing display name",
    "Input:",
    `handle: @${input.handle}`,
    `displayName: ${input.displayName || "(empty)"}`,
    `localReason: ${input.localReason || "(none)"}`,
    "snippet:",
    "```text",
    input.snippet || "(empty)",
    "```"
  ].join("\n\n");
}

function parseXAccountRiskDecision(content: string): XAccountRiskDecision {
  const trimmed = stripJsonFences(content);
  let record: Record<string, unknown> | null = null;

  const parseObject = (value: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  };

  const extractBalancedObject = (value: string): string | null => {
    const start = value.indexOf("{");
    if (start < 0) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < value.length; i += 1) {
      const ch = value[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return value.slice(start, i + 1);
        }
      }
    }
    return null;
  };

  const normalizedQuotes = trimmed
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  const candidates = [
    trimmed,
    extractBalancedObject(trimmed),
    normalizedQuotes,
    extractBalancedObject(normalizedQuotes)
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    record = parseObject(candidate);
    if (record) {
      break;
    }
  }

  if (!record) {
    const decisionMatch = trimmed.match(/decision\s*[:=]\s*"?(block|skip|unknown)"?/i);
    const categoryMatch = trimmed.match(/category\s*[:=]\s*"?(adult|marketing|normal|unknown)"?/i);
    const confidenceMatch = trimmed.match(/confidence\s*[:=]\s*"?([0-9]+(?:\.[0-9]+)?%?)"?/i);
    const reasonMatch = trimmed.match(/reason\s*[:=]\s*([^\n\r]+)/i);
    record = {
      decision: decisionMatch?.[1],
      category: categoryMatch?.[1],
      confidence: confidenceMatch?.[1] ?? "",
      reason: reasonMatch?.[1]?.trim() ?? ""
    };
  }

  const rawDecision = typeof record?.decision === "string" ? record.decision.trim().toLowerCase() : "";
  const rawCategory = typeof record?.category === "string" ? record.category.trim().toLowerCase() : "";
  const rawConfidence = typeof record?.confidence === "number"
    ? record.confidence
    : typeof record?.confidence === "string"
      ? (() => {
        const value = record.confidence.trim();
        if (value.endsWith("%")) {
          return Number(value.slice(0, -1)) / 100;
        }
        return Number(value);
      })()
      : Number.NaN;
  const reason = typeof record?.reason === "string" ? record.reason.trim() : "";

  const decision: XAccountRiskDecision["decision"] =
    rawDecision === "block" || rawDecision === "skip" || rawDecision === "unknown"
      ? rawDecision
      : "unknown";
  const category: XAccountRiskDecision["category"] =
    rawCategory === "adult" || rawCategory === "marketing" || rawCategory === "normal" || rawCategory === "unknown"
      ? rawCategory
      : "unknown";
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : 0;

  return {
    decision,
    category,
    confidence,
    reason: reason || "no_reason"
  };
}

function buildScreenshotAnalysisPrompt(input: {
  userPrompt: string;
  pageTitle?: string;
  pageUrl?: string;
  focusHint?: string;
}): string {
  const lines = [
    "You are analyzing a browser screenshot.",
    "Describe only what is visible in the screenshot and answer the user's request concisely.",
    "If some requested detail is not visible, say it is not visible instead of guessing."
  ];

  if (input.pageTitle) {
    lines.push(`Page title: ${input.pageTitle}`);
  }
  if (input.pageUrl) {
    lines.push(`Page URL: ${input.pageUrl}`);
  }
  if (input.focusHint) {
    lines.push(`Focus hint: ${input.focusHint}`);
  }

  lines.push(`User request: ${input.userPrompt.trim()}`);
  return lines.join("\n\n");
}

async function cropImageDataUrl(input: {
  imageDataUrl: string;
  rect: { left: number; top: number; width: number; height: number };
}): Promise<string> {
  const response = await fetch(input.imageDataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  const left = Math.max(0, Math.floor(input.rect.left));
  const top = Math.max(0, Math.floor(input.rect.top));
  const width = Math.max(1, Math.floor(input.rect.width));
  const height = Math.max(1, Math.floor(input.rect.height));
  const cropWidth = Math.min(width, Math.max(1, bitmap.width - left));
  const cropHeight = Math.min(height, Math.max(1, bitmap.height - top));

  const canvas = new OffscreenCanvas(cropWidth, cropHeight);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("OffscreenCanvas 2d context is unavailable");
  }
  context.drawImage(bitmap, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await croppedBlob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function parseTranslationResponse(content: string, expectedCount: number): string[] {
  const trimmed = content.trim();
  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Translation response is not valid JSON");
  }

  const translations = Array.isArray(parsed)
    ? parsed
    : (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { translations?: unknown[] }).translations)
      ? (parsed as { translations: unknown[] }).translations
      : null);

  if (!translations || !translations.every((item) => typeof item === "string")) {
    throw new Error("Translation response missing translations array");
  }

  if (translations.length !== expectedCount) {
    throw new Error(`Translation response count mismatch: expected ${expectedCount}, got ${translations.length}`);
  }

  return translations.map((item) => item.trim());
}

async function translateSegmentsWithCache(
  storage: StorageLike,
  config: LLMConfig,
  targetLanguage: string,
  segments: string[],
  invokeLLM: typeof requestChatCompletion
): Promise<string[]> {
  const cache = await getTranslationCache(storage);
  const results = new Array<string>(segments.length);
  const missingByText = new Map<string, number[]>();
  let cacheUpdated = false;

  for (let index = 0; index < segments.length; index += 1) {
    const text = segments[index];
    const cacheKey = buildTranslationCacheKey(targetLanguage, text);
    const cached = cache[cacheKey]?.translatedText;
    if (cached) {
      results[index] = cached;
      continue;
    }

    const bucket = missingByText.get(text);
    if (bucket) {
      bucket.push(index);
    } else {
      missingByText.set(text, [index]);
    }
  }

  const missingTexts = Array.from(missingByText.keys());
  const batchSize = Math.max(1, config.translationBatchSize || DEFAULT_CONFIG.translationBatchSize);

  for (let start = 0; start < missingTexts.length; start += batchSize) {
    const batch = missingTexts.slice(start, start + batchSize);
    const translationConfig = getTranslationRequestConfig({
      ...config,
      systemPrompt: [
        "You are a professional translation engine for bilingual reading.",
        "Translate accurately and naturally.",
        "Preserve original meaning and paragraph boundaries.",
        "Output strict JSON only."
      ].join(" ")
    });
    const translated = await invokeLLM({
      config: translationConfig,
      bodyExtras: getTranslationRequestBodyExtras(translationConfig),
      messages: [{ role: "user", content: buildTranslationPrompt(targetLanguage, batch) }]
    });

    const translations = parseTranslationResponse(translated, batch.length);
    translations.forEach((translatedText, batchIndex) => {
      const sourceText = batch[batchIndex];
      const positions = missingByText.get(sourceText) ?? [];
      const cacheKey = buildTranslationCacheKey(targetLanguage, sourceText);
      cache[cacheKey] = {
        translatedText,
        updatedAt: Date.now()
      };
      positions.forEach((position) => {
        results[position] = translatedText;
      });
      cacheUpdated = true;
    });
  }

  if (cacheUpdated) {
    await saveTranslationCache(storage, cache);
  }

  return results;
}

function safePostPortMessage(port: chrome.runtime.Port, message: unknown): void {
  try {
    port.postMessage(message);
  } catch {
    // Port may have been disconnected by the page.
  }
}

export function createBackgroundConnectHandler(storage: StorageLike, deps: BackgroundDependencies = {}) {
  const repo = new ConfigRepository(storage);
  const invokeLLMStream = deps.invokeLLMStream ?? requestChatCompletionStream;

  return (port: chrome.runtime.Port): void => {
    if (port.name !== "TRANSLATE_SEGMENT_STREAM") {
      return;
    }

    let disconnected = false;
    port.onDisconnect.addListener(() => {
      disconnected = true;
    });

    port.onMessage.addListener((message: { text?: unknown; targetLanguage?: unknown }) => {
      void (async () => {
        const text = typeof message.text === "string" ? message.text.trim() : "";
        if (!text) {
          safePostPortMessage(port, { type: "error", error: "text is required" });
          return;
        }

        try {
          const config = await repo.getConfig();
          if (!config.baseUrl.trim() || !config.apiKey.trim()) {
            safePostPortMessage(port, { type: "error", error: "Translation requires a configured Base URL and API Key" });
            return;
          }

          const targetLanguage = typeof message.targetLanguage === "string" && message.targetLanguage.trim()
            ? message.targetLanguage.trim()
            : config.translationTargetLanguage.trim();
          if (!targetLanguage) {
            safePostPortMessage(port, { type: "error", error: "targetLanguage is required" });
            return;
          }

          const cache = await getTranslationCache(storage);
          const cacheKey = buildTranslationCacheKey(targetLanguage, text);
          const cached = cache[cacheKey]?.translatedText;
          if (cached) {
            safePostPortMessage(port, { type: "done", text: cached, cached: true });
            return;
          }

          let translatedText = "";
          const translationConfig = getTranslationRequestConfig({
            ...config,
            systemPrompt: [
              "You are a professional streaming translation engine for bilingual reading.",
              "Translate accurately and naturally.",
              "The user message always contains SOURCE_TEXT; translate it even when it is a single word or short phrase.",
              "Output only the translation text itself, with no labels, source text, comments, or explanations."
            ].join(" ")
          });
          for await (const delta of invokeLLMStream({
            config: translationConfig,
            bodyExtras: getTranslationRequestBodyExtras(translationConfig),
            messages: [{ role: "user", content: buildStreamingTranslationPrompt(targetLanguage, text) }]
          })) {
            if (disconnected) return;
            const chunk = delta.content ?? "";
            if (!chunk) continue;
            translatedText += chunk;
            safePostPortMessage(port, { type: "delta", delta: chunk });
          }

          const finalText = translatedText.trim();
          if (finalText) {
            cache[cacheKey] = {
              translatedText: finalText,
              updatedAt: Date.now()
            };
            await saveTranslationCache(storage, cache);
          }
          safePostPortMessage(port, { type: "done", text: finalText });
        } catch (error) {
          safePostPortMessage(port, {
            type: "error",
            error: error instanceof Error ? error.message : "Translation failed"
          });
        }
      })();
    });
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveExternalSenderId(sender: unknown): string | null {
  if (!isObjectRecord(sender)) return null;
  return typeof sender.id === "string" && sender.id.trim() ? sender.id : null;
}

export function createBackgroundMessageHandler(storage: StorageLike, deps: BackgroundDependencies = {}) {
  const repo = new ConfigRepository(storage);
  const chatRepo = new ChatHistoryRepository(storage);
  const agentRepo = new AgentHistoryRepository(storage);
  const xBlockedAccountRepo = new XBlockedAccountRepository(storage);
  const siteActionMemoryRepo = new SiteActionMemoryRepository(storage);
  const invokeLLM = deps.invokeLLM ?? requestChatCompletion;
  const invokeLLMStream = deps.invokeLLMStream ?? requestChatCompletionStream;
  const runAgent = deps.runAgent ?? runAgentLoop;
  const runInSandbox = deps.executeInSandbox ?? executeScriptInSandbox;
  const activeStreamControllers = new Map<string, AbortController>();
  const MAX_EXTERNAL_AGENT_RUNS = 100;
  const LOCAL_COMMAND_RECONNECT_ALARM = "neonagent.localCommandReconnect";
  const LOCAL_COMMAND_RECONNECT_DELAY_MS = 3000;
  const LOCAL_COMMAND_WATCHDOG_MS = 15000;
  const LOCAL_COMMAND_CONNECTING_TIMEOUT_MS = 20000;
  const externalAgentRuns = new Map<string, ExternalAgentRunState>();
  type AutoSolveHandledRun = { url: string; signatures: string[]; claimedAt: number };
  const handledAutoSolveRuns = new Map<number, AutoSolveHandledRun>();
  let pendingAutoSolveRequest: {
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
  } | null = null;
  let localCommandSocket: WebSocket | null = null;
  let localCommandReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let localCommandWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  let localCommandConnectionKey = "";
  let localCommandStatus = {
    enabled: false,
    state: "disabled" as "disabled" | "connecting" | "connected" | "reconnecting" | "error",
    url: "",
    updatedAt: Date.now(),
    lastConnectedAt: null as number | null,
    lastError: ""
  };

  const setLocalCommandStatus = (updates: Partial<typeof localCommandStatus>): void => {
    localCommandStatus = {
      ...localCommandStatus,
      ...updates,
      updatedAt: Date.now()
    };
  };

  const getLocalCommandStatus = () => ({
    ...localCommandStatus,
    readyState: localCommandSocket?.readyState ?? null
  });

  const normalizeAutoSolveUrl = (url: string): string => {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return url.trim();
    }
  };

  const normalizeAutoSolveSignature = (signature: string): string => {
    return signature.replace(/\s+/g, " ").trim();
  };

  const shouldRunAutoSolve = async (tabId: number | null, url: string, signature: string): Promise<boolean> => {
    if (tabId === null || !url || !signature) {
      return false;
    }
    const normalized = {
      url: normalizeAutoSolveUrl(url),
      signature: normalizeAutoSolveSignature(signature)
    };
    const previous = handledAutoSolveRuns.get(tabId);
    if (
      previous &&
      previous.url === normalized.url &&
      previous.signatures.includes(normalized.signature)
    ) {
      return false;
    }

    const stored = await storage.get<Record<string, AutoSolveHandledRun | { url: string; signature: string; claimedAt: number }>>(AUTO_SOLVE_HANDLED_KEY);
    const rawExisting = stored?.[String(tabId)];
    const existing: AutoSolveHandledRun | undefined = rawExisting
      ? {
          url: rawExisting.url,
          signatures: "signatures" in rawExisting
            ? rawExisting.signatures
            : [rawExisting.signature],
          claimedAt: rawExisting.claimedAt
        }
      : undefined;
    if (
      existing &&
      existing.url === normalized.url &&
      existing.signatures.includes(normalized.signature)
    ) {
      handledAutoSolveRuns.set(tabId, existing);
      return false;
    }

    const signatures = existing && existing.url === normalized.url
      ? [...existing.signatures, normalized.signature]
      : [normalized.signature];
    const next: AutoSolveHandledRun = {
      url: normalized.url,
      signatures: Array.from(new Set(signatures)).slice(-50),
      claimedAt: Date.now()
    };
    handledAutoSolveRuns.set(tabId, next);
    await storage.set(AUTO_SOLVE_HANDLED_KEY, {
      ...(stored ?? {}),
      [String(tabId)]: next
    });
    return true;
  };

  const isLocalCommandSocketActive = (): boolean => {
    return Boolean(
      localCommandSocket &&
      (localCommandSocket.readyState === WebSocket.OPEN ||
        localCommandSocket.readyState === WebSocket.CONNECTING)
    );
  };

  const clearLocalCommandReconnectTimer = (): void => {
    if (localCommandReconnectTimer) {
      clearTimeout(localCommandReconnectTimer);
      localCommandReconnectTimer = null;
    }
  };

  const pruneExternalAgentRuns = (): void => {
    if (externalAgentRuns.size < MAX_EXTERNAL_AGENT_RUNS) return;
    let oldestKey: string | undefined;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, state] of externalAgentRuns.entries()) {
      if (state.updatedAt < oldestTs) {
        oldestTs = state.updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) externalAgentRuns.delete(oldestKey);
  };

  const upsertExternalToolCall = (
    run: ExternalAgentRunState,
    toolCallId: string,
    defaults: Omit<ExternalAgentToolCallState, "id">
  ): ExternalAgentToolCallState => {
    const existing = run.toolCalls.find((t) => t.id === toolCallId);
    if (existing) return existing;
    const created: ExternalAgentToolCallState = { id: toolCallId, ...defaults };
    run.toolCalls.push(created);
    return created;
  };

  const trackExternalAgentEvent = (event: AgentProgressEvent): void => {
    const requestId = event.payload.requestId;
    const run = externalAgentRuns.get(requestId);
    if (!run) return;

    const now = Date.now();
    run.updatedAt = now;

    if (event.type === "AGENT_TEXT_DELTA") {
      run.assistantText += event.payload.delta;
      return;
    }
    if (event.type === "AGENT_THINKING_DELTA") {
      run.thinkingText += event.payload.delta;
      return;
    }
    if (event.type === "AGENT_TOOL_CALL") {
      upsertExternalToolCall(run, event.payload.toolCallId, {
        name: event.payload.name,
        arguments: event.payload.arguments,
        status: "running"
      });
      return;
    }
    if (event.type === "AGENT_TOOL_RESULT") {
      const tc = upsertExternalToolCall(run, event.payload.toolCallId, {
        name: event.payload.name,
        arguments: "",
        status: event.payload.isError ? "error" : "success"
      });
      tc.result = event.payload.result;
      tc.isError = event.payload.isError;
      tc.status = event.payload.isError ? "error" : "success";
      return;
    }
    if (event.type === "AGENT_ITERATION_START") {
      run.iterations = event.payload.iteration;
      return;
    }
    if (event.type === "AGENT_TURN_COMPLETE") {
      run.status = "completed";
      run.iterations = event.payload.iterations;
      run.finishedAt = now;
      return;
    }
    if (event.type === "AGENT_ERROR") {
      run.status = "error";
      run.error = event.payload.error;
      run.finishedAt = now;
    }
  };

  const serializeExternalRun = (run: ExternalAgentRunState) => ({
    requestId: run.requestId,
    senderId: run.senderId,
    tabId: run.tabId,
    userMessage: run.userMessage,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    iterations: run.iterations,
    assistantText: run.assistantText,
    thinkingText: run.thinkingText,
    error: run.error,
    toolCalls: run.toolCalls
  });

  const emitStreamEvent =
    deps.emitStreamEvent ??
    ((event: RuntimeStreamEvent) => {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(event).catch(() => {/* receiver not ready */});
      }
    });

  const emitAgentEventRaw =
    deps.emitAgentEvent ??
    ((event: AgentProgressEvent) => {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(event).catch(() => {/* receiver not ready */});
      }
    });

  const emitAgentEvent = async (event: AgentProgressEvent): Promise<void> => {
    trackExternalAgentEvent(event);
    await emitAgentEventRaw(event);
  };

  const emitExternalAgentRunStarted = (input: {
    requestId: string;
    senderId: string;
    tabId: number;
    userMessage: string;
  }): void => {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: "AGENT_EXTERNAL_RUN_STARTED",
        payload: {
          requestId: input.requestId,
          senderId: input.senderId,
          tabId: input.tabId,
          userMessage: input.userMessage,
          createdAt: Date.now()
        }
      }).catch(() => {/* receiver not ready */});
    }
  };

  const sendTabMessageWithAutoInject = async (tabId: number, msg: unknown) => {
    if (typeof chrome !== "undefined" && chrome.scripting?.executeScript) {
      const existing = await chrome.tabs.sendMessage(tabId, { type: "PING" }).catch(() => null);
      if (!existing) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["pageFullscreenBlock.js"],
          world: "MAIN"
        }).catch(() => null);

        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"]
        }).catch(() => null);
        await new Promise(r => setTimeout(r, 50));
      }
    }
    if (typeof chrome !== "undefined" && chrome.tabs?.sendMessage) {
      return chrome.tabs.sendMessage(tabId, msg);
    }
    return Promise.reject(new Error("chrome.tabs.sendMessage not available"));
  };

  const sendTabMessage = deps.sendTabMessage ?? sendTabMessageWithAutoInject;

  const waitForTabComplete = async (tabId: number, timeoutMs = 15000): Promise<void> => {
    if (typeof chrome === "undefined" || !chrome.tabs?.get || !chrome.tabs?.onUpdated) {
      return;
    }

    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (current?.status === "complete") {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error(`Timed out waiting for tab ${tabId} to load`));
      }, timeoutMs);

      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") {
          return;
        }
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  };

  const activeAgentControllers = new Map<string, AbortController>();

  const executePageTool = async (
    tabId: number,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> => {
    const response = await sendTabMessage(tabId, {
      type: "AGENT_TOOL_EXECUTE",
      payload: { toolName, arguments: args }
    }) as { ok?: boolean; data?: string } | undefined;

    return {
      toolCallId: "",
      toolName,
      output: response?.ok
        ? (typeof response.data === "string" ? response.data : JSON.stringify(response.data))
        : `Tool execution failed: ${JSON.stringify(response)}`,
      isError: !response?.ok
    };
  };

  const executeBackgroundTool = async (
    tabId: number,
    toolName: string,
    args: Record<string, unknown>,
    activeConfig: LLMConfig
  ): Promise<ToolResult> => {
    if (toolName === "save_memory") {
      const content = typeof args.content === "string" ? args.content : "";
      if (!content) {
        return { toolCallId: "", toolName, output: "Error: content is required", isError: true };
      }
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
      try {
        const entry = await addMemory(storage, content, tags);
        // Auto-compress if threshold exceeded
        const allMem = await getAllMemories(storage);
        if (needsCompression(allMem) && activeConfig.baseUrl && activeConfig.apiKey) {
          const callLLM = async (prompt: string): Promise<string> => {
            return invokeLLM({ config: activeConfig, messages: [{ role: "user", content: prompt }] });
          };
          try {
            const cr = await compressMemories(storage, callLLM);
            return { toolCallId: "", toolName, output: `Memory saved (id: ${entry.id}): ${entry.content}\n[自动压缩] ${cr.originalCount} → ${cr.compressedCount} 条`, isError: false };
          } catch {
            // Compression failed, still return success for save
          }
        }
        return { toolCallId: "", toolName, output: `Memory saved (id: ${entry.id}): ${entry.content}`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Save memory failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "search_memories") {
      const query = typeof args.query === "string" ? args.query : "";
      try {
        const results = await searchMemories(storage, query);
        if (results.length === 0) {
          return { toolCallId: "", toolName, output: "No memories found.", isError: false };
        }
        const formatted = results.map((e) => {
          const tagStr = e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : "";
          return `- [${e.id}] ${e.content}${tagStr}`;
        }).join("\n");
        return { toolCallId: "", toolName, output: `Found ${results.length} memories:\n${formatted}`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Search memories failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "delete_memory") {
      const memoryId = typeof args.memoryId === "string" ? args.memoryId : "";
      if (!memoryId) {
        return { toolCallId: "", toolName, output: "Error: memoryId is required", isError: true };
      }
      try {
        const deleted = await deleteMemory(storage, memoryId);
        return {
          toolCallId: "", toolName,
          output: deleted ? `Memory ${memoryId} deleted.` : `Memory ${memoryId} not found.`,
          isError: !deleted
        };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Delete memory failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "navigate") {
      const url = typeof args.url === "string" ? args.url : "";
      if (!url) {
        return { toolCallId: "", toolName, output: "Error: url is required", isError: true };
      }
      try {
        if (typeof chrome === "undefined" || !chrome.tabs?.update) {
          throw new Error("chrome.tabs.update not available");
        }
        await chrome.tabs.update(tabId, { url });
        return { toolCallId: "", toolName, output: `Navigating to ${url}`, isError: false };
      } catch (error) {
        return {
          toolCallId: "",
          toolName,
          output: `Navigate failed: ${error instanceof Error ? error.message : String(error)}`,
          isError: true
        };
      }
    }

    if (toolName === "wait_for_url") {
      const urlPattern = typeof args.urlPattern === "string" ? args.urlPattern : "";
      const timeout = typeof args.timeout === "number" ? args.timeout : 5000;
      if (!urlPattern) {
        return { toolCallId: "", toolName, output: "Error: urlPattern is required", isError: true };
      }

      let matcher: RegExp;
      try {
        const regexMatch = /^\/(.+)\/([dgimsuvy]*)$/.exec(urlPattern.trim());
        if (regexMatch) {
          matcher = new RegExp(regexMatch[1], regexMatch[2]);
        } else {
          matcher = new RegExp(urlPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        }
      } catch (error) {
        return { toolCallId: "", toolName, output: `Error: Invalid regex pattern - ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }

      try {
        if (typeof chrome === "undefined" || !chrome.tabs?.get) {
          throw new Error("chrome.tabs.get not available");
        }

        const checkUrl = async () => {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs && tabs.length > 0) {
            return tabs[0].url || "";
          }
          const tab = await chrome.tabs.get(tabId);
          return tab.url || "";
        };

        const initialUrl = await checkUrl();
        if (matcher.test(initialUrl)) {
          return { toolCallId: "", toolName, output: `URL matched immediately: ${initialUrl}`, isError: false };
        }

        return await new Promise<ToolResult>((resolve) => {
          const startTime = Date.now();
          const interval = setInterval(async () => {
            try {
              const currentUrl = await checkUrl();
              if (matcher.test(currentUrl)) {
                clearInterval(interval);
                resolve({ toolCallId: "", toolName, output: `URL matched: ${currentUrl}`, isError: false });
              } else if (Date.now() - startTime >= timeout) {
                clearInterval(interval);
                resolve({ toolCallId: "", toolName, output: `Timeout waiting for URL pattern: ${urlPattern} (${timeout}ms). Current URL: ${currentUrl}`, isError: false });
              }
            } catch (err) {
              clearInterval(interval);
              resolve({ toolCallId: "", toolName, output: `Error checking tab URL: ${err instanceof Error ? err.message : String(err)}`, isError: true });
            }
          }, 200);
        });
      } catch (error) {
        return {
          toolCallId: "", toolName,
          output: `wait_for_url failed: ${error instanceof Error ? error.message : String(error)}`,
          isError: true
        };
      }
    }

    if (toolName === "get_current_time") {
      const now = new Date();
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const info = {
        datetime: now.toLocaleString("zh-CN", { hour12: false }),
        iso: now.toISOString(),
        timestamp: now.getTime(),
        dayOfWeek: days[now.getDay()],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
      return { toolCallId: "", toolName, output: JSON.stringify(info), isError: false };
    }

    if (toolName === "analyze_page_screenshot") {
      const userPrompt = typeof args.prompt === "string" && args.prompt.trim()
        ? args.prompt.trim()
        : "请识别这张网页截图的主要内容，并简要总结关键信息。";
      const selector = typeof args.selector === "string" && args.selector.trim()
        ? args.selector.trim()
        : "";
      const selectorIndex = typeof args.index === "number" ? args.index : 0;

      if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model) {
        return { toolCallId: "", toolName, output: "Error: LLM config is incomplete", isError: true };
      }
      if (typeof chrome === "undefined" || !chrome.tabs?.get || !chrome.tabs?.captureVisibleTab) {
        return { toolCallId: "", toolName, output: "Error: chrome.tabs screenshot API not available", isError: true };
      }

      try {
        const tab = await chrome.tabs.get(tabId);
        const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        let focusHint = "";

        if (selector) {
          try {
            const rectResponse = await sendTabMessage(tabId, {
              type: "AGENT_TOOL_EXECUTE",
              payload: {
                toolName: "get_element_rect",
                arguments: {
                  selector,
                  index: selectorIndex
                }
              }
            }) as { ok?: boolean; data?: string } | undefined;
            if (rectResponse?.ok && typeof rectResponse.data === "string") {
              focusHint = `Focus on selector ${selector}[${selectorIndex}] with metadata: ${rectResponse.data}`;
            } else {
              focusHint = `Focus on selector ${selector}[${selectorIndex}] if it is visible in the screenshot.`;
            }
          } catch {
            focusHint = `Focus on selector ${selector}[${selectorIndex}] if it is visible in the screenshot.`;
          }
        }

        const content = await requestVisionChatCompletion({
          config: {
            ...activeConfig,
            maxTokens: Math.min(activeConfig.maxTokens, 1024),
            agentMaxTokens: Math.min(activeConfig.agentMaxTokens, 1024)
          },
          prompt: buildScreenshotAnalysisPrompt({
            userPrompt,
            pageTitle: tab.title,
            pageUrl: tab.url,
            focusHint
          }),
          imageDataUrl: screenshotDataUrl,
          systemPrompt: "You are a precise browser screenshot analyst.",
          bodyExtras: getChatThinkingRequestBodyExtras(activeConfig, false)
        });

        return { toolCallId: "", toolName, output: content, isError: false };
      } catch (error) {
        return {
          toolCallId: "",
          toolName,
          output: `Analyze page screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
          isError: true
        };
      }
    }

    if (toolName === "analyze_element_screenshot") {
      const selector = typeof args.selector === "string" && args.selector.trim() ? args.selector.trim() : "";
      const selectorIndex = typeof args.index === "number" ? args.index : 0;
      const userPrompt = typeof args.prompt === "string" && args.prompt.trim()
        ? args.prompt.trim()
        : "请识别这个网页元素截图的主要内容，并简要总结关键信息。";

      if (!selector) {
        return { toolCallId: "", toolName, output: "Error: selector is required", isError: true };
      }
      if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model) {
        return { toolCallId: "", toolName, output: "Error: LLM config is incomplete", isError: true };
      }
      if (typeof chrome === "undefined" || !chrome.tabs?.get || !chrome.tabs?.captureVisibleTab) {
        return { toolCallId: "", toolName, output: "Error: chrome.tabs screenshot API not available", isError: true };
      }

      try {
        const rectResponse = await sendTabMessage(tabId, {
          type: "AGENT_TOOL_EXECUTE",
          payload: {
            toolName: "get_element_rect",
            arguments: {
              selector,
              index: selectorIndex
            }
          }
        }) as { ok?: boolean; data?: string } | undefined;
        if (!rectResponse?.ok || typeof rectResponse.data !== "string") {
          throw new Error(`Failed to resolve element rect for ${selector}[${selectorIndex}]`);
        }

        const rectPayload = JSON.parse(rectResponse.data) as {
          rect?: { left?: number; top?: number; width?: number; height?: number };
          viewport?: { width?: number; height?: number; devicePixelRatio?: number };
          text?: string;
          tagName?: string;
        };
        const rect = rectPayload.rect;
        if (
          !rect ||
          typeof rect.left !== "number" ||
          typeof rect.top !== "number" ||
          typeof rect.width !== "number" ||
          typeof rect.height !== "number"
        ) {
          throw new Error("Element rect response is invalid");
        }

        const tab = await chrome.tabs.get(tabId);
        const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        const viewportWidth = typeof rectPayload.viewport?.width === "number" && rectPayload.viewport.width > 0
          ? rectPayload.viewport.width
          : null;
        const viewportHeight = typeof rectPayload.viewport?.height === "number" && rectPayload.viewport.height > 0
          ? rectPayload.viewport.height
          : null;
        const dpr = typeof rectPayload.viewport?.devicePixelRatio === "number" && rectPayload.viewport.devicePixelRatio > 0
          ? rectPayload.viewport.devicePixelRatio
          : 1;
        const croppedDataUrl = await cropImageDataUrl({
          imageDataUrl: screenshotDataUrl,
          rect: {
            left: rect.left * dpr,
            top: rect.top * dpr,
            width: rect.width * dpr,
            height: rect.height * dpr
          }
        });

        const content = await requestVisionChatCompletion({
          config: {
            ...activeConfig,
            maxTokens: Math.min(activeConfig.maxTokens, 1024),
            agentMaxTokens: Math.min(activeConfig.agentMaxTokens, 1024)
          },
          prompt: buildScreenshotAnalysisPrompt({
            userPrompt,
            pageTitle: tab.title,
            pageUrl: tab.url,
            focusHint: `Element ${selector}[${selectorIndex}] <${rectPayload.tagName ?? "unknown"}> text preview: ${rectPayload.text ?? ""}; viewport=${viewportWidth ?? "unknown"}x${viewportHeight ?? "unknown"}; dpr=${dpr}`
          }),
          imageDataUrl: croppedDataUrl,
          systemPrompt: "You are a precise browser screenshot analyst.",
          bodyExtras: getChatThinkingRequestBodyExtras(activeConfig, false)
        });

        return { toolCallId: "", toolName, output: content, isError: false };
      } catch (error) {
        return {
          toolCallId: "",
          toolName,
          output: `Analyze element screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
          isError: true
        };
      }
    }

    // ── Skill Tools ──

    if (toolName === "create_skill") {
      const name = typeof args.name === "string" ? args.name : "";
      const description = typeof args.description === "string" ? args.description : "";
      const steps = Array.isArray(args.steps) ? args.steps as Array<string | SkillStep> : [];
      if (!name || !description || steps.length === 0) {
        return { toolCallId: "", toolName, output: "Error: name, description, and steps are required", isError: true };
      }
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
      try {
        const skill = await createSkill(storage, name, description, steps, tags);
        return { toolCallId: "", toolName, output: `Skill created (id: ${skill.id}, v${skill.version}): ${skill.name} — ${skill.steps.length} steps`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Create skill failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "list_skills") {
      const query = typeof args.query === "string" ? args.query : "";
      try {
        const results = await listSkills(storage, query);
        if (results.length === 0) {
          return { toolCallId: "", toolName, output: "No skills found.", isError: false };
        }
        const formatted = results.map((s) => {
          const tagStr = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
          const usage = s.usageCount > 0 ? ` (used ${s.usageCount}x)` : "";
          return `- [${s.id}] ${s.name} (v${s.version}): ${s.description}${tagStr}${usage}`;
        }).join("\n");
        return { toolCallId: "", toolName, output: `Found ${results.length} skills:\n${formatted}`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `List skills failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "execute_skill") {
      const skillId = typeof args.skillId === "string" ? args.skillId : "";
      if (!skillId) {
        return { toolCallId: "", toolName, output: "Error: skillId is required", isError: true };
      }
      try {
        const skill = await executeSkill(storage, skillId);
        const playbook = formatSkillForExecution(skill);
        return { toolCallId: "", toolName, output: playbook, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Execute skill failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "run_skill") {
      const skillId = typeof args.skillId === "string" ? args.skillId : "";
      const stopOnError = typeof args.stopOnError === "boolean" ? args.stopOnError : true;
      if (!skillId) {
        return { toolCallId: "", toolName, output: "Error: skillId is required", isError: true };
      }

      try {
        const skill = await executeSkill(storage, skillId);
        const lines: string[] = [`Running skill "${skill.name}" (id: ${skill.id}, v${skill.version})`];
        let hasError = false;

        for (let i = 0; i < skill.steps.length; i += 1) {
          const step = skill.steps[i];
          if (step.type !== "tool" || !step.toolName) {
            lines.push(`${i + 1}. instruction: ${step.instruction}`);
            continue;
          }

          const stepToolName = step.toolName;
          if (stepToolName === "run_skill") {
            hasError = true;
            lines.push(`${i + 1}. tool:${stepToolName} -> blocked recursive run_skill call`);
            if (stopOnError) break;
            continue;
          }

          const stepArgs = step.arguments && typeof step.arguments === "object" ? step.arguments : {};
          const isPageTool = PAGE_TOOLS.has(stepToolName);
          const isBackgroundTool = BACKGROUND_TOOLS.has(stepToolName);
          const scriptSkill = !isPageTool && !isBackgroundTool
            ? await findScriptSkillByToolName(storage, stepToolName)
            : null;

          if (!isPageTool && !isBackgroundTool && !scriptSkill) {
            hasError = true;
            lines.push(`${i + 1}. tool:${stepToolName} -> unknown tool`);
            if (stopOnError) break;
            continue;
          }

          const result = isPageTool
            ? await executePageTool(tabId, stepToolName, stepArgs)
            : await executeBackgroundTool(tabId, stepToolName, stepArgs, activeConfig);
          hasError = hasError || result.isError;
          lines.push(`${i + 1}. tool:${stepToolName} -> ${result.isError ? "error" : "ok"}\n${result.output}`);
          if (result.isError && stopOnError) break;
        }

        return { toolCallId: "", toolName, output: lines.join("\n"), isError: hasError };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Run skill failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "update_skill") {
      const skillId = typeof args.skillId === "string" ? args.skillId : "";
      if (!skillId) {
        return { toolCallId: "", toolName, output: "Error: skillId is required", isError: true };
      }
      const updates: { name?: string; description?: string; steps?: Array<string | SkillStep>; tags?: string[] } = {};
      if (typeof args.name === "string") updates.name = args.name;
      if (typeof args.description === "string") updates.description = args.description;
      if (Array.isArray(args.steps)) updates.steps = args.steps as Array<string | SkillStep>;
      if (Array.isArray(args.tags)) updates.tags = args.tags.map(String);
      try {
        const skill = await updateSkill(storage, skillId, updates);
        return { toolCallId: "", toolName, output: `Skill updated (id: ${skill.id}, v${skill.version}): ${skill.name} — ${skill.steps.length} steps`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Update skill failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "delete_skill") {
      const skillId = typeof args.skillId === "string" ? args.skillId : "";
      if (!skillId) {
        return { toolCallId: "", toolName, output: "Error: skillId is required", isError: true };
      }
      try {
        const deleted = await deleteSkill(storage, skillId);
        return {
          toolCallId: "", toolName,
          output: deleted ? `Skill ${skillId} deleted.` : `Skill ${skillId} not found.`,
          isError: !deleted
        };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Delete skill failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    // ── Script Skill Management Tools ──

    if (toolName === "install_script_skill") {
      const name = typeof args.name === "string" ? args.name : "";
      const description = typeof args.description === "string" ? args.description : "";
      const code = typeof args.code === "string" ? args.code : "";
      const tools = Array.isArray(args.tools) ? args.tools as ScriptSkillToolDef[] : [];
      if (!name || !code || tools.length === 0) {
        return { toolCallId: "", toolName, output: "Error: name, code, and tools are required", isError: true };
      }
      const envVars = (typeof args.envVars === "object" && args.envVars !== null)
        ? args.envVars as Record<string, string> : {};
      const sourceUrl = typeof args.sourceUrl === "string" ? args.sourceUrl : undefined;
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
      try {
        const skill = await createScriptSkill(storage, {
          name, description, code, tools, envVars, sourceUrl, tags
        });
        const toolNames = skill.tools.map((t) => t.name).join(", ");
        return { toolCallId: "", toolName, output: `Script skill installed (id: ${skill.id}): "${skill.name}" — tools: ${toolNames}\n注意：新安装的工具将在下一轮对话中可用。`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Install script skill failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "list_script_skills") {
      const query = typeof args.query === "string" ? args.query : "";
      try {
        const results = await listScriptSkills(storage, query);
        if (results.length === 0) {
          return { toolCallId: "", toolName, output: "No script skills installed.", isError: false };
        }
        const formatted = results.map((s) => {
          const toolNames = s.tools.map((t) => t.name).join(", ");
          const tagStr = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
          const usage = s.usageCount > 0 ? ` (used ${s.usageCount}x)` : "";
          const source = s.sourceUrl ? ` (from: ${s.sourceUrl})` : "";
          return `- [${s.id}] ${s.name} (v${s.version}): ${s.description}${tagStr}${usage}${source}\n  Tools: ${toolNames}`;
        }).join("\n");
        return { toolCallId: "", toolName, output: `Found ${results.length} script skills:\n${formatted}`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `List script skills failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "update_script_skill") {
      const skillId = typeof args.skillId === "string" ? args.skillId : "";
      if (!skillId) {
        return { toolCallId: "", toolName, output: "Error: skillId is required", isError: true };
      }
      const updates: Record<string, unknown> = {};
      if (typeof args.name === "string") updates.name = args.name;
      if (typeof args.description === "string") updates.description = args.description;
      if (typeof args.code === "string") updates.code = args.code;
      if (Array.isArray(args.tools)) updates.tools = args.tools;
      if (typeof args.envVars === "object" && args.envVars !== null) updates.envVars = args.envVars;
      if (Array.isArray(args.tags)) updates.tags = args.tags.map(String);
      try {
        const skill = await updateScriptSkill(storage, skillId, updates as Parameters<typeof updateScriptSkill>[2]);
        return { toolCallId: "", toolName, output: `Script skill updated (id: ${skill.id}, v${skill.version}): "${skill.name}"`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Update script skill failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "uninstall_script_skill") {
      const skillId = typeof args.skillId === "string" ? args.skillId : "";
      if (!skillId) {
        return { toolCallId: "", toolName, output: "Error: skillId is required", isError: true };
      }
      try {
        const deleted = await deleteScriptSkill(storage, skillId);
        return {
          toolCallId: "", toolName,
          output: deleted ? `Script skill ${skillId} uninstalled.` : `Script skill ${skillId} not found.`,
          isError: !deleted
        };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Uninstall script skill failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    // ── Scheduled Task Tools ──

    if (toolName === "create_scheduled_task") {
      const name = typeof args.name === "string" ? args.name : "";
      const instruction = typeof args.instruction === "string" ? args.instruction : "";
      const scheduleType = typeof args.scheduleType === "string" ? args.scheduleType : "";
      const time = typeof args.time === "string" ? args.time : "";
      if (!name || !instruction || !scheduleType) {
        return { toolCallId: "", toolName, output: "Error: name, instruction, and scheduleType are required", isError: true };
      }
      try {
        const task = await createScheduledTask(storage, {
          name,
          instruction,
          scheduleType: scheduleType as "once" | "interval" | "daily" | "weekly",
          time,
          dayOfWeek: typeof args.dayOfWeek === "number" ? args.dayOfWeek : undefined,
          intervalMinutes: typeof args.intervalMinutes === "number" ? args.intervalMinutes : undefined
        });
        // Register the alarm
        await registerTaskAlarm(task);
        return { toolCallId: "", toolName, output: `Scheduled task created (id: ${task.id}): "${task.name}" — ${describeTaskSchedule(task)}`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Create scheduled task failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "list_scheduled_tasks") {
      const query = typeof args.query === "string" ? args.query : "";
      try {
        const results = await listScheduledTasks(storage, query);
        if (results.length === 0) {
          return { toolCallId: "", toolName, output: "No scheduled tasks found.", isError: false };
        }
        const formatted = results.map((t) => {
          const status = t.enabled ? "✅" : "⏸️";
          const lastRun = t.lastRunAt ? `上次: ${new Date(t.lastRunAt).toLocaleString("zh-CN")}` : "尚未执行";
          return `- ${status} [${t.id}] ${t.name}: ${describeTaskSchedule(t)} (${lastRun}, 共${t.runCount}次)`;
        }).join("\n");
        return { toolCallId: "", toolName, output: `Found ${results.length} tasks:\n${formatted}`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `List tasks failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "update_scheduled_task") {
      const taskId = typeof args.taskId === "string" ? args.taskId : "";
      if (!taskId) {
        return { toolCallId: "", toolName, output: "Error: taskId is required", isError: true };
      }
      const updates: Record<string, unknown> = {};
      if (typeof args.name === "string") updates.name = args.name;
      if (typeof args.instruction === "string") updates.instruction = args.instruction;
      if (typeof args.scheduleType === "string") updates.scheduleType = args.scheduleType;
      if (typeof args.time === "string") updates.time = args.time;
      if (typeof args.dayOfWeek === "number") updates.dayOfWeek = args.dayOfWeek;
      if (typeof args.intervalMinutes === "number") updates.intervalMinutes = args.intervalMinutes;
      if (typeof args.enabled === "boolean") updates.enabled = args.enabled;
      try {
        const task = await updateScheduledTask(storage, taskId, updates);
        // Re-register alarm with new schedule
        await unregisterTaskAlarm(taskId);
        if (task.enabled) {
          await registerTaskAlarm(task);
        }
        return { toolCallId: "", toolName, output: `Task updated (id: ${task.id}): "${task.name}" — ${task.enabled ? "已启用" : "已暂停"}, ${describeTaskSchedule(task)}`, isError: false };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Update task failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    if (toolName === "delete_scheduled_task") {
      const taskId = typeof args.taskId === "string" ? args.taskId : "";
      if (!taskId) {
        return { toolCallId: "", toolName, output: "Error: taskId is required", isError: true };
      }
      try {
        await unregisterTaskAlarm(taskId);
        const deleted = await deleteScheduledTask(storage, taskId);
        return {
          toolCallId: "", toolName,
          output: deleted ? `Task ${taskId} deleted.` : `Task ${taskId} not found.`,
          isError: !deleted
        };
      } catch (error) {
        return { toolCallId: "", toolName, output: `Delete task failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }

    // ── Dynamic Script Skill Tool Execution (via sandbox) ──
    {
      const scriptSkill = await findScriptSkillByToolName(storage, toolName);
      if (scriptSkill) {
        try {
          const output = await runInSandbox(scriptSkill.code, toolName, args, scriptSkill.envVars);
          await recordScriptSkillUsage(storage, scriptSkill.id);
          return { toolCallId: "", toolName, output, isError: false };
        } catch (error) {
          return {
            toolCallId: "", toolName,
            output: `Script skill tool "${toolName}" failed: ${error instanceof Error ? error.message : String(error)}`,
            isError: true
          };
        }
      }
    }

    return { toolCallId: "", toolName, output: `Unknown background tool: ${toolName}`, isError: true };
  };

  const startAgentRun = (payload: AgentRunConfig): void => {
    const controller = new AbortController();
    activeAgentControllers.set(payload.requestId, controller);

    const getActiveTabId = async (fallback: number) => {
       try {
           const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
           return tab?.id ?? fallback;
       } catch {
           return fallback;
       }
    };

    void (async () => {
      try {
        await runAgent(
          payload,
          {
            emit: emitAgentEvent,
            executePageTool: async (tabId, toolName, args) => executePageTool(await getActiveTabId(tabId), toolName, args),
            executeBackgroundTool: async (tabId, toolName, args) => executeBackgroundTool(await getActiveTabId(tabId), toolName, args, payload.config),
            getPageContext: async (tabId) => {
              const activeId = await getActiveTabId(tabId);
              try {
                const resp = await sendTabMessage(activeId, { type: "GET_PAGE_CONTEXT" }) as { ok?: boolean; data?: string } | undefined;
                if (resp?.ok && typeof resp.data === "string") {
                  const titleMatch = resp.data.match(/^Title:\s*(.+)/);
                  return { title: titleMatch?.[1], url: undefined };
                }
              } catch {
                // ignored
              }
              return {};
            },
            getMemories: async () => {
              return getAllMemories(storage);
            },
            getSkills: async () => {
              return getAllSkills(storage);
            },
            getScheduledTasks: async () => {
              return getAllScheduledTasks(storage);
            },
            getScriptSkills: async () => {
              return getAllScriptSkills(storage);
            }
          },
          controller.signal
        );
      } catch (error) {
        await emitAgentEvent({
          type: "AGENT_ERROR",
          payload: {
            requestId: payload.requestId,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      } finally {
        activeAgentControllers.delete(payload.requestId);
      }
    })();
  };

  const resolveTabId = async (input: unknown): Promise<number | undefined> => {
    if (typeof input === "number" && Number.isInteger(input) && input > 0) {
      return input;
    }
    if (typeof chrome === "undefined" || !chrome.tabs?.query) {
      return undefined;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  };

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const sendLocalCommandResponse = (response: Record<string, unknown>): void => {
    if (localCommandSocket?.readyState === WebSocket.OPEN) {
      localCommandSocket.send(JSON.stringify(response));
    }
  };

  const waitForExternalRun = async (
    requestId: string,
    timeoutMs: number,
    pollIntervalMs: number
  ): Promise<ExternalAgentRunState | undefined> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = externalAgentRuns.get(requestId);
      if (run && run.status !== "running") return run;
      await sleep(Math.max(100, pollIntervalMs));
    }
    return externalAgentRuns.get(requestId);
  };

  const handleLocalCommandEnvelope = async (
    envelope: LocalCommandEnvelope,
    activeConfig: LLMConfig
  ): Promise<Record<string, unknown>> => {
    const requestId = typeof envelope.requestId === "string" && envelope.requestId.trim()
      ? envelope.requestId.trim()
      : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const type = typeof envelope.type === "string" ? envelope.type : "";

    if (activeConfig.localCommandToken && envelope.token !== activeConfig.localCommandToken) {
      return { type: "response", requestId, ok: false, errors: ["Invalid local command token"] };
    }

    if (type === "ping") {
      return { type: "response", requestId, ok: true, data: { pong: true } };
    }

    if (type === "get_result") {
      const rid = typeof envelope.requestId === "string" ? envelope.requestId.trim() : "";
      const run = rid ? externalAgentRuns.get(rid) : undefined;
      return run
        ? { type: "response", requestId: rid, ok: true, data: serializeExternalRun(run) }
        : { type: "response", requestId: rid || requestId, ok: false, errors: [`Result not found for requestId: ${rid}`] };
    }

    if (type === "tool_call" || type === "run_skill") {
      const tabId = await resolveTabId(envelope.tabId);
      if (!tabId) {
        return { type: "response", requestId, ok: false, errors: ["tabId is required (or no active tab found)"] };
      }

      const toolName = type === "run_skill"
        ? "run_skill"
        : (typeof envelope.toolName === "string" ? envelope.toolName.trim() : "");
      if (!toolName) {
        return { type: "response", requestId, ok: false, errors: ["toolName is required"] };
      }

      const args = type === "run_skill"
        ? {
            skillId: envelope.skillId,
            stopOnError: envelope.stopOnError
          }
        : (isObjectRecord(envelope.arguments) ? envelope.arguments : {});

      const config = envelope.config ?? activeConfig;
      const isPageTool = PAGE_TOOLS.has(toolName);
      const isBackgroundTool = BACKGROUND_TOOLS.has(toolName);
      const scriptSkill = !isPageTool && !isBackgroundTool
        ? await findScriptSkillByToolName(storage, toolName)
        : null;
      if (!isPageTool && !isBackgroundTool && !scriptSkill) {
        return { type: "response", requestId, ok: false, errors: [`Unknown tool: ${toolName}`] };
      }

      const result = isPageTool
        ? await executePageTool(tabId, toolName, args)
        : await executeBackgroundTool(tabId, toolName, args, config);
      return {
        type: "response",
        requestId,
        ok: !result.isError,
        data: {
          toolName,
          result: result.output,
          isError: result.isError
        }
      };
    }

    if (type === "command" || type === "agent" || type === "agent_run" || type === "work") {
      const userMessage = typeof envelope.userMessage === "string" ? envelope.userMessage.trim() : "";
      if (!userMessage) {
        return { type: "response", requestId, ok: false, errors: ["userMessage is required"] };
      }

      const tabId = await resolveTabId(envelope.tabId);
      if (!tabId) {
        return { type: "response", requestId, ok: false, errors: ["tabId is required (or no active tab found)"] };
      }

      const config = envelope.config ?? activeConfig;
      const validation = validateConfig(config);
      if (!validation.valid) {
        return { type: "response", requestId, ok: false, errors: [`Invalid config: ${validation.errors.join("; ")}`] };
      }

      const runPayload: AgentRunConfig = {
        requestId,
        tabId,
        config,
        userMessage,
        history: envelope.history,
        maxIterations: typeof envelope.maxIterations === "number" ? envelope.maxIterations : undefined,
        toolTimeout: typeof envelope.toolTimeout === "number" ? envelope.toolTimeout : undefined
      };

      pruneExternalAgentRuns();
      externalAgentRuns.set(requestId, {
        requestId,
        senderId: "local-websocket",
        tabId,
        userMessage,
        status: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        assistantText: "",
        thinkingText: "",
        toolCalls: []
      });
      emitExternalAgentRunStarted({
        requestId,
        senderId: "local-websocket",
        tabId,
        userMessage
      });
      startAgentRun(runPayload);

      if (!envelope.waitForResult) {
        return { type: "response", requestId, ok: true, data: { requestId, status: "running" } };
      }

      const run = await waitForExternalRun(
        requestId,
        typeof envelope.waitTimeoutMs === "number" ? envelope.waitTimeoutMs : 120000,
        typeof envelope.pollIntervalMs === "number" ? envelope.pollIntervalMs : 1000
      );

      if (!run || run.status === "running") {
        return {
          type: "response",
          requestId,
          ok: false,
          errors: ["Timed out waiting for command result"],
          data: run ? serializeExternalRun(run) : undefined
        };
      }

      return { type: "response", requestId, ok: run.status === "completed", data: serializeExternalRun(run) };
    }

    return { type: "response", requestId, ok: false, errors: [`Unknown local command type: ${type}`] };
  };

  const scheduleLocalCommandReconnect = (delayMs = LOCAL_COMMAND_RECONNECT_DELAY_MS): void => {
    clearLocalCommandReconnectTimer();
    localCommandReconnectTimer = setTimeout(() => {
      localCommandReconnectTimer = null;
      void refreshLocalCommandSocket();
    }, delayMs);
    (localCommandReconnectTimer as { unref?: () => void }).unref?.();

    if (typeof chrome !== "undefined" && chrome.alarms?.create) {
      chrome.alarms.create(LOCAL_COMMAND_RECONNECT_ALARM, {
        when: Date.now() + Math.max(1000, delayMs)
      }).catch(() => {/* ignored */});
    }
  };

  const ensureLocalCommandWatchdog = (): void => {
    if (localCommandWatchdogTimer) return;
    localCommandWatchdogTimer = setInterval(() => {
      void (async () => {
        const config = await repo.getConfig();
        if (!config.localCommandEnabled) return;

        const state = localCommandSocket?.readyState;
        const staleConnecting =
          state === WebSocket.CONNECTING &&
          Date.now() - localCommandStatus.updatedAt > LOCAL_COMMAND_CONNECTING_TIMEOUT_MS;

        if (!localCommandSocket || state === WebSocket.CLOSING || state === WebSocket.CLOSED || staleConnecting) {
          if (localCommandSocket) {
            try {
              localCommandSocket.close();
            } catch {
              // ignored
            }
            localCommandSocket = null;
          }
          setLocalCommandStatus({
            enabled: true,
            state: "reconnecting",
            url: config.localCommandWsUrl,
            lastError: staleConnecting ? "WebSocket connection timed out" : localCommandStatus.lastError
          });
          scheduleLocalCommandReconnect(0);
        }
      })();
    }, LOCAL_COMMAND_WATCHDOG_MS);
    (localCommandWatchdogTimer as { unref?: () => void }).unref?.();
  };

  const refreshLocalCommandSocket = async (): Promise<void> => {
    const config = await repo.getConfig();
    const key = `${config.localCommandEnabled ? "1" : "0"}:${config.localCommandWsUrl}:${config.localCommandToken}`;

    if (!config.localCommandEnabled || typeof WebSocket === "undefined") {
      setLocalCommandStatus({
        enabled: false,
        state: "disabled",
        url: config.localCommandWsUrl,
        lastError: typeof WebSocket === "undefined" ? "WebSocket is not available in this runtime" : ""
      });
      localCommandConnectionKey = key;
      clearLocalCommandReconnectTimer();
      if (typeof chrome !== "undefined" && chrome.alarms?.clear) {
        chrome.alarms.clear(LOCAL_COMMAND_RECONNECT_ALARM).catch(() => {/* ignored */});
      }
      if (localCommandWatchdogTimer) {
        clearInterval(localCommandWatchdogTimer);
        localCommandWatchdogTimer = null;
      }
      if (localCommandSocket) {
        localCommandSocket.close();
        localCommandSocket = null;
      }
      return;
    }

    if (localCommandConnectionKey === key && isLocalCommandSocketActive()) {
      return;
    }

    if (localCommandSocket && !isLocalCommandSocketActive()) {
      try {
        localCommandSocket.close();
      } catch {
        // ignored
      }
      localCommandSocket = null;
    }

    setLocalCommandStatus({
      enabled: true,
      state: "connecting",
      url: config.localCommandWsUrl,
      lastError: ""
    });
    ensureLocalCommandWatchdog();
    localCommandConnectionKey = key;
    clearLocalCommandReconnectTimer();
    if (localCommandSocket) {
      localCommandSocket.close();
      localCommandSocket = null;
    }

    const ws = new WebSocket(config.localCommandWsUrl);
    localCommandSocket = ws;

    ws.onopen = () => {
      clearLocalCommandReconnectTimer();
      if (typeof chrome !== "undefined" && chrome.alarms?.clear) {
        chrome.alarms.clear(LOCAL_COMMAND_RECONNECT_ALARM).catch(() => {/* ignored */});
      }
      setLocalCommandStatus({
        enabled: true,
        state: "connected",
        url: config.localCommandWsUrl,
        lastConnectedAt: Date.now(),
        lastError: ""
      });
      sendLocalCommandResponse({
        type: "hello",
        ok: true,
        data: {
          agent: "NeonAgent",
          commands: ["command", "agent", "agent_run", "work", "tool_call", "run_skill", "get_result", "ping"]
        }
      });
    };

    ws.onmessage = (event) => {
      void (async () => {
        let envelope: LocalCommandEnvelope;
        try {
          envelope = JSON.parse(String(event.data)) as LocalCommandEnvelope;
        } catch {
          sendLocalCommandResponse({ type: "response", ok: false, errors: ["Invalid JSON message"] });
          return;
        }

        try {
          const latestConfig = await repo.getConfig();
          const response = await handleLocalCommandEnvelope(envelope, latestConfig);
          sendLocalCommandResponse(response);
        } catch (error) {
          sendLocalCommandResponse({
            type: "response",
            requestId: envelope.requestId,
            ok: false,
            errors: [error instanceof Error ? error.message : String(error)]
          });
        }
      })();
    };

    ws.onclose = () => {
      if (localCommandSocket === ws) {
        localCommandSocket = null;
      }
      if (localCommandConnectionKey === key && config.localCommandEnabled) {
        setLocalCommandStatus({
          enabled: true,
          state: "reconnecting",
          url: config.localCommandWsUrl
        });
        scheduleLocalCommandReconnect();
      }
    };

    ws.onerror = () => {
      setLocalCommandStatus({
        enabled: true,
        state: "error",
        url: config.localCommandWsUrl,
        lastError: "WebSocket connection error"
      });
      scheduleLocalCommandReconnect();
      ws.close();
    };
  };

  void refreshLocalCommandSocket();
  if (typeof chrome !== "undefined" && chrome.alarms?.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === LOCAL_COMMAND_RECONNECT_ALARM) {
        void refreshLocalCommandSocket();
      }
    });
  }

  return (message: { type?: string; payload?: unknown }, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    void (async () => {
      if (message.type === "PING") {
        sendResponse({ ok: true, data: "PONG" });
        return;
      }

      if (message.type === "GET_CONFIG") {
        const config = await repo.getConfig();
        sendResponse({ ok: true, data: config });
        return;
      }

      if (message.type === "ENSURE_MAIN_WORLD_BLOCK_SCRIPT") {
        const tabId = sender.tab?.id;
        if (typeof tabId !== "number" || !chrome.scripting?.executeScript) {
          sendResponse({ ok: false, errors: ["Unable to inject main-world block script"] });
          return;
        }

        const frameIds = typeof sender.frameId === "number" ? [sender.frameId] : undefined;
        await chrome.scripting.executeScript({
          target: frameIds ? { tabId, frameIds } : { tabId },
          files: ["pageFullscreenBlock.js"],
          world: "MAIN"
        });
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "GET_LOCAL_COMMAND_STATUS") {
        sendResponse({ ok: true, data: getLocalCommandStatus() });
        return;
      }

      if (message.type === "GET_PENDING_AUTO_SOLVE_REQUEST") {
        const payload = (message.payload ?? {}) as { tabId?: number };
        const tabId = typeof payload.tabId === "number" ? payload.tabId : null;
        const pending = pendingAutoSolveRequest &&
          (pendingAutoSolveRequest.payload.tabId === null || tabId === null || pendingAutoSolveRequest.payload.tabId === tabId)
          ? pendingAutoSolveRequest
          : null;
        sendResponse({ ok: true, data: pending });
        return;
      }

      if (message.type === "CLEAR_PENDING_AUTO_SOLVE_REQUEST") {
        const payload = (message.payload ?? {}) as { signature?: string };
        if (!payload.signature || pendingAutoSolveRequest?.payload.signature === payload.signature) {
          pendingAutoSolveRequest = null;
        }
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "CLAIM_AUTO_SOLVE_RUN") {
        const payload = (message.payload ?? {}) as { tabId?: number; url?: string; signature?: string };
        const tabId = typeof payload.tabId === "number" ? payload.tabId : null;
        const url = typeof payload.url === "string" ? payload.url : "";
        const signature = typeof payload.signature === "string" ? payload.signature : "";
        const shouldRun = await shouldRunAutoSolve(tabId, url, signature);
        sendResponse({ ok: true, data: { shouldRun } });
        return;
      }

      if (message.type === "AUTO_SOLVE_CURRENT_PAGE_REQUEST") {
        const config = await repo.getConfig();
        if (!config.autoSolveCurrentPage) {
          sendResponse({ ok: true, data: { ignored: true, reason: "disabled" } });
          return;
        }

        const payload = (message.payload ?? {}) as Record<string, unknown>;
        const event = {
          type: "AUTO_SOLVE_CURRENT_PAGE_REQUESTED",
          payload: {
            tabId: sender.tab?.id ?? null,
            questionCount: typeof payload.questionCount === "number" ? payload.questionCount : 0,
            signature: typeof payload.signature === "string" ? payload.signature : "",
            reason: typeof payload.reason === "string" ? payload.reason : "",
            title: typeof payload.title === "string" ? payload.title : "",
            url: typeof payload.url === "string" ? payload.url : "",
            createdAt: Date.now()
          }
        } as const;

        if (!await shouldRunAutoSolve(event.payload.tabId, event.payload.url, event.payload.signature)) {
          sendResponse({ ok: true, data: { notified: false, duplicate: true } });
          return;
        }

        pendingAutoSolveRequest = event;

        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage(event).catch(() => {/* receiver not ready */});
        }
        sendResponse({ ok: true, data: { notified: true } });
        return;
      }

      if (message.type === "SAVE_CONFIG") {
        const config = message.payload as LLMConfig;
        const validation = validateConfig(config);
        if (!validation.valid) {
          sendResponse({ ok: false, errors: validation.errors });
          return;
        }

        await repo.saveConfig(config);
        void refreshLocalCommandSocket();
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "TEST_LLM_CONFIG") {
        const config = {
          ...(message.payload as LLMConfig),
          agentMaxTokens: Math.min(Math.max((message.payload as LLMConfig)?.agentMaxTokens || 16, 16), 64),
          maxTokens: Math.min(Math.max((message.payload as LLMConfig)?.maxTokens || 16, 16), 64)
        };
        const validation = validateConfig(config);
        if (!validation.valid) {
          sendResponse({ ok: false, errors: validation.errors });
          return;
        }

        const startedAt = Date.now();
        try {
          let content = "";
          for await (const delta of invokeLLMStream({
            config,
            messages: [
              {
                role: "user",
                content: "Reply with exactly: ok"
              }
            ]
          })) {
            if (delta.content) content += delta.content;
            if (!delta.content && delta.reasoning) content += delta.reasoning;
          }
          sendResponse({
            ok: true,
            data: {
              model: config.model,
              latencyMs: Date.now() - startedAt,
              content: content.trim().slice(0, 200)
            }
          });
        } catch (error) {
          sendResponse({
            ok: false,
            errors: [error instanceof Error ? error.message : String(error)]
          });
        }
        return;
      }

      if (message.type === "GET_CHAT_SESSIONS") {
        const sessions = await chatRepo.getSessions();
        sendResponse({ ok: true, data: sessions });
        return;
      }

      if (message.type === "SAVE_CHAT_SESSION") {
        const session = message.payload as ChatSession;
        if (!session?.id || !Array.isArray(session?.messages)) {
          sendResponse({ ok: false, errors: ["Invalid chat session payload"] });
          return;
        }

        await chatRepo.saveSession(session);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "DELETE_CHAT_SESSION") {
        const payload = message.payload as { sessionId?: string };
        if (!payload?.sessionId) {
          sendResponse({ ok: false, errors: ["sessionId is required"] });
          return;
        }

        await chatRepo.deleteSession(payload.sessionId);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "CLEAR_CHAT_SESSIONS") {
        await chatRepo.clearAllSessions();
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "GET_AGENT_SESSIONS") {
        const sessions = await agentRepo.getSessions();
        sendResponse({ ok: true, data: sessions });
        return;
      }

      if (message.type === "SAVE_AGENT_SESSION") {
        const session = message.payload as AgentSession;
        if (!session?.id || !Array.isArray(session?.messages)) {
          sendResponse({ ok: false, errors: ["Invalid agent session payload"] });
          return;
        }
        await agentRepo.saveSession(session);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "DELETE_AGENT_SESSION") {
        const payload = message.payload as { sessionId?: string };
        if (!payload?.sessionId) {
          sendResponse({ ok: false, errors: ["sessionId is required"] });
          return;
        }
        await agentRepo.deleteSession(payload.sessionId);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "CLEAR_AGENT_SESSIONS") {
        await agentRepo.clearAllSessions();
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "RECORD_X_BLOCKED_ACCOUNT") {
        const payload = message.payload as Partial<XBlockedAccountRecord> | undefined;
        if (!payload?.handle || !payload?.id) {
          sendResponse({ ok: false, errors: ["id and handle are required"] });
          return;
        }

        const record: XBlockedAccountRecord = {
          id: payload.id,
          handle: payload.handle,
          displayName: typeof payload.displayName === "string" ? payload.displayName : payload.handle,
          reason: payload.reason === "adult" ? "adult" : "marketing",
          blockedAt: typeof payload.blockedAt === "number" ? payload.blockedAt : Date.now(),
          sourceUrl: typeof payload.sourceUrl === "string" ? payload.sourceUrl : "",
          postSnippet: typeof payload.postSnippet === "string" ? payload.postSnippet : "",
          restoredAt: typeof payload.restoredAt === "number" ? payload.restoredAt : undefined
        };
        await xBlockedAccountRepo.saveRecord(record);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "LIST_X_BLOCKED_ACCOUNTS") {
        const records = await xBlockedAccountRepo.getRecords();
        sendResponse({ ok: true, data: records });
        return;
      }

      if (message.type === "RESTORE_X_BLOCKED_ACCOUNT") {
        const payload = message.payload as { handle?: string } | undefined;
        const handle = typeof payload?.handle === "string" ? payload.handle.trim() : "";
        if (!handle) {
          sendResponse({ ok: false, errors: ["handle is required"] });
          return;
        }

        try {
          if (typeof chrome === "undefined" || !chrome.tabs?.query || !chrome.tabs?.update) {
            throw new Error("chrome.tabs API not available");
          }

          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab?.id) {
            throw new Error("No active tab found");
          }

          const targetUrl = `https://x.com/${handle}`;
          await chrome.tabs.update(activeTab.id, { url: targetUrl });
          await waitForTabComplete(activeTab.id);

          const response = await sendTabMessage(activeTab.id, {
            type: "RESTORE_X_BLOCKED_ACCOUNT",
            payload: { handle }
          }) as { ok?: boolean; data?: string; errors?: string[] } | undefined;

          if (!response?.ok) {
            throw new Error(Array.isArray(response?.errors) ? response.errors.join(", ") : "Failed to restore blocked account");
          }

          await xBlockedAccountRepo.markRestored(handle);
          sendResponse({ ok: true, data: { handle, url: targetUrl, result: response.data ?? "restored" } });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to restore blocked account"] });
        }
        return;
      }

      if (message.type === "CLASSIFY_X_ACCOUNT_RISK") {
        const payload = message.payload as {
          handle?: string;
          displayName?: string;
          snippet?: string;
          localReason?: string;
        } | undefined;
        const handle = typeof payload?.handle === "string" ? payload.handle.trim().replace(/^@/, "").toLowerCase() : "";
        const snippet = typeof payload?.snippet === "string" ? payload.snippet.trim().slice(0, 120) : "";
        const displayName = typeof payload?.displayName === "string" ? payload.displayName.trim().slice(0, 80) : "";
        const localReason = typeof payload?.localReason === "string" ? payload.localReason.trim().slice(0, 24) : "";

        if (!handle) {
          sendResponse({ ok: false, errors: ["handle is required"] });
          return;
        }

        try {
          const config = await repo.getConfig();
          if (!config.baseUrl || !config.apiKey || !config.model) {
            sendResponse({
              ok: true,
              data: {
                decision: "unknown",
                category: "unknown",
                confidence: 0,
                reason: "config_unavailable"
              } satisfies XAccountRiskDecision
            });
            return;
          }

          const classificationConfig: LLMConfig = {
            ...config,
            maxTokens: Math.min(config.maxTokens, 96),
            agentMaxTokens: Math.min(config.agentMaxTokens, 96)
          };
          const raw = await invokeLLM({
            config: classificationConfig,
            messages: [{
              role: "user",
              content: buildXAccountRiskPrompt({ handle, displayName, snippet, localReason })
            }],
            bodyExtras: getChatThinkingRequestBodyExtras(classificationConfig, false)
          });
          const decision = parseXAccountRiskDecision(raw);
          sendResponse({ ok: true, data: decision });
        } catch (error) {
          console.warn("[NeonAgent] X account model review failed", error);
          sendResponse({
            ok: true,
            data: {
              decision: "unknown",
              category: "unknown",
              confidence: 0,
              reason: "llm_error"
            } satisfies XAccountRiskDecision
          });
        }
        return;
      }

      if (message.type === "LIST_SKILLS") {
        try {
          const skills = await getAllSkills(storage);
          const summaries = skills.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            version: s.version,
            usageCount: s.usageCount,
            tags: s.tags
          }));
          sendResponse({ ok: true, data: summaries });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to list skills"] });
        }
        return;
      }

      if (message.type === "GET_SKILL") {
        const payload = message.payload as { skillId?: string } | undefined;
        if (!payload?.skillId) {
          sendResponse({ ok: false, errors: ["skillId is required"] });
          return;
        }
        try {
          const skill = await getSkillById(storage, payload.skillId);
          if (!skill) {
            sendResponse({ ok: false, errors: ["Skill not found"] });
          } else {
            sendResponse({ ok: true, data: skill });
          }
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to get skill"] });
        }
        return;
      }

      if (message.type === "UPDATE_SKILL_DIRECT") {
        const payload = message.payload as { skillId?: string; name?: string; description?: string; steps?: string[]; tags?: string[] } | undefined;
        if (!payload?.skillId) {
          sendResponse({ ok: false, errors: ["skillId is required"] });
          return;
        }
        try {
          const updates: { name?: string; description?: string; steps?: string[]; tags?: string[] } = {};
          if (typeof payload.name === "string") updates.name = payload.name;
          if (typeof payload.description === "string") updates.description = payload.description;
          if (Array.isArray(payload.steps)) updates.steps = payload.steps.map(String);
          if (Array.isArray(payload.tags)) updates.tags = payload.tags.map(String);
          const skill = await updateSkill(storage, payload.skillId, updates);
          sendResponse({ ok: true, data: skill });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to update skill"] });
        }
        return;
      }

      if (message.type === "DELETE_SKILL_DIRECT") {
        const payload = message.payload as { skillId?: string } | undefined;
        if (!payload?.skillId) {
          sendResponse({ ok: false, errors: ["skillId is required"] });
          return;
        }
        try {
          const deleted = await deleteSkill(storage, payload.skillId);
          sendResponse({ ok: true, data: { deleted } });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to delete skill"] });
        }
        return;
      }

      if (message.type === "IMPORT_SKILLS") {
        const payload = message.payload as { skills?: unknown[] } | undefined;
        if (!Array.isArray(payload?.skills)) {
          sendResponse({ ok: false, errors: ["skills array is required"] });
          return;
        }
        try {
          const result = await importSkills(storage, payload.skills as Array<{ name: string; description: string; steps: string[]; tags?: string[] }>);
          sendResponse({ ok: true, data: result });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to import skills"] });
        }
        return;
      }

      // ── Script Skill UI Message Handlers ──

      if (message.type === "LIST_SCRIPT_SKILLS") {
        try {
          const skills = await getAllScriptSkills(storage);
          const summaries = skills.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            tools: s.tools.map((t) => t.name),
            envVars: Object.keys(s.envVars),
            sourceUrl: s.sourceUrl,
            version: s.version,
            usageCount: s.usageCount,
            tags: s.tags
          }));
          sendResponse({ ok: true, data: summaries });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to list script skills"] });
        }
        return;
      }

      if (message.type === "GET_SCRIPT_SKILL") {
        const payload = message.payload as { skillId?: string } | undefined;
        if (!payload?.skillId) {
          sendResponse({ ok: false, errors: ["skillId is required"] });
          return;
        }
        try {
          const { getScriptSkillById } = await import("./shared/agentScriptSkill.js");
          const skill = await getScriptSkillById(storage, payload.skillId);
          if (!skill) {
            sendResponse({ ok: false, errors: ["Script skill not found"] });
          } else {
            sendResponse({ ok: true, data: skill });
          }
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to get script skill"] });
        }
        return;
      }

      if (message.type === "INSTALL_SCRIPT_SKILL") {
        const payload = message.payload as {
          name?: string;
          description?: string;
          code?: string;
          tools?: ScriptSkillToolDef[];
          envVars?: Record<string, string>;
          sourceUrl?: string;
          tags?: string[];
        } | undefined;
        if (!payload?.name || !payload?.code || !Array.isArray(payload?.tools)) {
          sendResponse({ ok: false, errors: ["name, code, and tools are required"] });
          return;
        }
        try {
          const skill = await createScriptSkill(storage, {
            name: payload.name,
            description: payload.description ?? "",
            code: payload.code,
            tools: payload.tools,
            envVars: payload.envVars,
            sourceUrl: payload.sourceUrl,
            tags: payload.tags
          });
          sendResponse({ ok: true, data: skill });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to install script skill"] });
        }
        return;
      }

      if (message.type === "UPDATE_SCRIPT_SKILL") {
        const payload = message.payload as {
          skillId?: string;
          name?: string;
          description?: string;
          code?: string;
          tools?: ScriptSkillToolDef[];
          envVars?: Record<string, string>;
          tags?: string[];
        } | undefined;
        if (!payload?.skillId) {
          sendResponse({ ok: false, errors: ["skillId is required"] });
          return;
        }
        try {
          const skill = await updateScriptSkill(storage, payload.skillId, {
            name: payload.name,
            description: payload.description,
            code: payload.code,
            tools: payload.tools,
            envVars: payload.envVars,
            tags: payload.tags
          });
          sendResponse({ ok: true, data: skill });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to update script skill"] });
        }
        return;
      }

      if (message.type === "UNINSTALL_SCRIPT_SKILL") {
        const payload = message.payload as { skillId?: string } | undefined;
        if (!payload?.skillId) {
          sendResponse({ ok: false, errors: ["skillId is required"] });
          return;
        }
        try {
          const deleted = await deleteScriptSkill(storage, payload.skillId);
          sendResponse({ ok: true, data: { deleted } });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to uninstall script skill"] });
        }
        return;
      }

      if (message.type === "LIST_MEMORIES") {
        try {
          const memories = await getAllMemories(storage);
          sendResponse({ ok: true, data: memories });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to list memories"] });
        }
        return;
      }

      if (message.type === "DELETE_MEMORY_DIRECT") {
        const payload = message.payload as { memoryId?: string } | undefined;
        if (!payload?.memoryId) {
          sendResponse({ ok: false, errors: ["memoryId is required"] });
          return;
        }
        try {
          const deleted = await deleteMemory(storage, payload.memoryId);
          sendResponse({ ok: true, data: { deleted } });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to delete memory"] });
        }
        return;
      }

      if (message.type === "GET_SITE_ACTION_MEMORIES") {
        const payload = message.payload as {
          host?: string;
          query?: string;
          role?: string;
          action?: "click";
          limit?: number;
        } | undefined;
        if (!payload?.host || !payload?.query) {
          sendResponse({ ok: false, errors: ["host and query are required"] });
          return;
        }
        try {
          const matches = await siteActionMemoryRepo.findMatches({
            host: payload.host,
            query: payload.query,
            role: payload.role,
            action: payload.action,
            limit: payload.limit
          });
          sendResponse({ ok: true, data: matches });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to load site action memories"] });
        }
        return;
      }

      if (message.type === "RECORD_SITE_ACTION_MEMORY") {
        const payload = message.payload as {
          host?: string;
          query?: string;
          role?: string;
          action?: "click";
          selector?: string;
          tagName?: string;
          label?: string;
        } | undefined;
        if (!payload?.host || !payload?.query || !payload?.selector) {
          sendResponse({ ok: false, errors: ["host, query and selector are required"] });
          return;
        }
        try {
          const entry = await siteActionMemoryRepo.recordSuccess({
            host: payload.host,
            query: payload.query,
            role: payload.role,
            action: payload.action,
            selector: payload.selector,
            tagName: payload.tagName,
            label: payload.label
          });
          sendResponse({ ok: true, data: entry });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to record site action memory"] });
        }
        return;
      }

      if (message.type === "IMPORT_MEMORIES") {
        const payload = message.payload as { memories?: unknown[] } | undefined;
        if (!Array.isArray(payload?.memories)) {
          sendResponse({ ok: false, errors: ["memories array is required"] });
          return;
        }
        try {
          const result = await importMemories(storage, payload.memories as Array<{ content: string; tags?: string[] }>);
          sendResponse({ ok: true, data: result });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to import memories"] });
        }
        return;
      }

      if (message.type === "COMPRESS_MEMORIES") {
        try {
          const memories = await getAllMemories(storage);
          if (!needsCompression(memories)) {
            sendResponse({ ok: true, data: { originalCount: memories.length, compressedCount: memories.length, skipped: true } });
            return;
          }
          const config = await storage.get<LLMConfig>("neonagent.config") ?? {} as LLMConfig;
          if (!config.baseUrl || !config.apiKey) {
            sendResponse({ ok: false, errors: ["LLM 未配置，无法执行记忆压缩"] });
            return;
          }
          const callLLM = async (prompt: string): Promise<string> => {
            return invokeLLM({
              config,
              messages: [{ role: "user", content: prompt }]
            });
          };
          const result = await compressMemories(storage, callLLM);
          sendResponse({ ok: true, data: result });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to compress memories"] });
        }
        return;
      }

      if (message.type === "LIST_SCHEDULED_TASKS") {
        try {
          const tasks = await getAllScheduledTasks(storage);
          sendResponse({ ok: true, data: tasks });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Failed to list tasks"] });
        }
        return;
      }

      if (message.type === "TRANSLATE_SEGMENTS") {
        const payload = message.payload as { segments?: unknown[]; targetLanguage?: string } | undefined;
        if (!Array.isArray(payload?.segments)) {
          sendResponse({ ok: false, errors: ["segments array is required"] });
          return;
        }

        const segments = payload.segments.map((segment) => String(segment).trim()).filter(Boolean);
        if (segments.length === 0) {
          sendResponse({ ok: true, data: { translations: [], targetLanguage: payload?.targetLanguage ?? "" } });
          return;
        }

        try {
          const config = await repo.getConfig();
          if (!config.baseUrl.trim() || !config.apiKey.trim()) {
            sendResponse({ ok: false, errors: ["Translation requires a configured Base URL and API Key"] });
            return;
          }

          const targetLanguage = typeof payload.targetLanguage === "string" && payload.targetLanguage.trim()
            ? payload.targetLanguage.trim()
            : config.translationTargetLanguage.trim();

          if (!targetLanguage) {
            sendResponse({ ok: false, errors: ["targetLanguage is required"] });
            return;
          }

          const translations = await translateSegmentsWithCache(
            storage,
            config,
            targetLanguage,
            segments,
            invokeLLM
          );

          sendResponse({ ok: true, data: { translations, targetLanguage } });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Translation failed"] });
        }
        return;
      }

      if (message.type === "LOOKUP_WORD_DETAILS") {
        const payload = message.payload as { text?: unknown; targetLanguage?: unknown } | undefined;
        const text = typeof payload?.text === "string" ? payload.text.trim() : "";
        if (!text) {
          sendResponse({ ok: false, errors: ["text is required"] });
          return;
        }

        try {
          const config = await repo.getConfig();
          if (!config.baseUrl.trim() || !config.apiKey.trim()) {
            sendResponse({ ok: false, errors: ["Word lookup requires a configured Base URL and API Key"] });
            return;
          }

          const targetLanguage = typeof payload?.targetLanguage === "string" && payload.targetLanguage.trim()
            ? payload.targetLanguage.trim()
            : config.translationTargetLanguage.trim();
          if (!targetLanguage) {
            sendResponse({ ok: false, errors: ["targetLanguage is required"] });
            return;
          }

          const cache = await getWordLookupCache(storage);
          const cacheKey = buildWordLookupCacheKey(targetLanguage, text);
          const cached = cache[cacheKey];
          if (cached) {
            sendResponse({
              ok: true,
              data: {
                translation: cached.translation,
                pronunciation: cached.pronunciation,
                partOfSpeech: cached.partOfSpeech,
                targetLanguage,
                cached: true
              }
            });
            return;
          }

          const translationConfig = getTranslationRequestConfig({
            ...config,
            systemPrompt: [
              "You are a concise bilingual dictionary assistant.",
              "For a single word, provide only the requested structured fields.",
              "Output strict JSON only."
            ].join(" ")
          });
          const raw = await invokeLLM({
            config: translationConfig,
            bodyExtras: getTranslationRequestBodyExtras(translationConfig),
            messages: [{ role: "user", content: buildWordLookupPrompt(targetLanguage, text) }]
          });

          const details = parseWordLookupResponse(raw);
          cache[cacheKey] = {
            ...details,
            updatedAt: Date.now()
          };
          await saveWordLookupCache(storage, cache);

          sendResponse({
            ok: true,
            data: {
              ...details,
              targetLanguage
            }
          });
        } catch (error) {
          sendResponse({ ok: false, errors: [error instanceof Error ? error.message : "Word lookup failed"] });
        }
        return;
      }

      if (isRuntimeMessage(message) && message.type === "LLM_REQUEST") {
        try {
          const content = await invokeLLM({
            config: message.payload.config,
            messages: message.payload.messages,
            referenceContext: message.payload.referenceContext,
            pageContext: message.payload.pageContext,
            bodyExtras: getChatThinkingRequestBodyExtras(
              message.payload.config,
              message.payload.thinkingEnabled
            )
          });

          sendResponse({ ok: true, data: { content } });
        } catch (error) {
          sendResponse({
            ok: false,
            errors: [error instanceof Error ? error.message : "LLM request failed"]
          });
        }
        return;
      }

      if (isRuntimeMessage(message) && message.type === "LLM_STREAM_REQUEST") {
        sendResponse({ ok: true, data: { requestId: message.payload.requestId } });

        const controller = new AbortController();
        activeStreamControllers.set(message.payload.requestId, controller);

        try {
          for await (const chunk of invokeLLMStream({
            config: message.payload.config,
            messages: message.payload.messages,
            referenceContext: message.payload.referenceContext,
            pageContext: message.payload.pageContext,
            bodyExtras: getChatThinkingRequestBodyExtras(
              message.payload.config,
              message.payload.thinkingEnabled
            ),
            signal: controller.signal
          })) {
            emitStreamEvent({
              type: "LLM_STREAM_CHUNK",
              payload: {
                requestId: message.payload.requestId,
                delta: chunk.content ?? "",
                reasoning: chunk.reasoning ?? undefined
              }
            });
          }

          emitStreamEvent({
            type: "LLM_STREAM_DONE",
            payload: { requestId: message.payload.requestId }
          });
        } catch (error) {
          if (!controller.signal.aborted) {
            emitStreamEvent({
              type: "LLM_STREAM_ERROR",
              payload: {
                requestId: message.payload.requestId,
                error: error instanceof Error ? error.message : "LLM stream failed"
              }
            });
          }
        } finally {
          activeStreamControllers.delete(message.payload.requestId);
        }

        return;
      }

      if (isRuntimeMessage(message) && message.type === "LLM_STREAM_CANCEL") {
        const controller = activeStreamControllers.get(message.payload.requestId);
        if (controller) {
          controller.abort();
          sendResponse({
            ok: true,
            data: { requestId: message.payload.requestId, canceled: true }
          });
        } else {
          sendResponse({
            ok: true,
            data: { requestId: message.payload.requestId, canceled: false }
          });
        }
        return;
      }

      if (message.type === "AGENT_EXTERNAL_TOOL_CALL") {
        const senderId = resolveExternalSenderId(sender);
        if (!senderId) {
          sendResponse({ ok: false, errors: ["Only extension senders can call AGENT_EXTERNAL_TOOL_CALL"] });
          return;
        }

        const payload = message.payload as AgentExternalToolCallPayload | undefined;
        const toolName = typeof payload?.toolName === "string" ? payload.toolName.trim() : "";
        if (!toolName) {
          sendResponse({ ok: false, errors: ["toolName is required"] });
          return;
        }

        const tabId = await resolveTabId(payload?.tabId);
        if (!tabId) {
          sendResponse({ ok: false, errors: ["tabId is required (or no active tab found)"] });
          return;
        }

        const args = isObjectRecord(payload?.arguments) ? payload.arguments : {};
        const requestId = typeof payload?.requestId === "string" && payload.requestId.trim()
          ? payload.requestId.trim()
          : `ext-tool-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const config = payload?.config ?? await repo.getConfig();

        const isPageTool = PAGE_TOOLS.has(toolName);
        const isBackgroundTool = BACKGROUND_TOOLS.has(toolName);
        const scriptSkill = !isPageTool && !isBackgroundTool
          ? await findScriptSkillByToolName(storage, toolName)
          : null;

        if (!isPageTool && !isBackgroundTool && !scriptSkill) {
          sendResponse({ ok: false, errors: [`Unknown tool: ${toolName}`] });
          return;
        }

        const result = isPageTool
          ? await executePageTool(tabId, toolName, args)
          : await executeBackgroundTool(tabId, toolName, args, config);

        sendResponse({
          ok: !result.isError,
          data: {
            requestId,
            senderId,
            toolName,
            result: result.output,
            isError: result.isError
          }
        });
        return;
      }

      if (message.type === "AGENT_EXTERNAL_GET_RESULT") {
        const senderId = resolveExternalSenderId(sender);
        if (!senderId) {
          sendResponse({ ok: false, errors: ["Only extension senders can call AGENT_EXTERNAL_GET_RESULT"] });
          return;
        }

        const payload = message.payload as AgentExternalGetResultPayload | undefined;
        const requestId = typeof payload?.requestId === "string" ? payload.requestId.trim() : "";
        if (!requestId) {
          sendResponse({ ok: false, errors: ["requestId is required"] });
          return;
        }

        const run = externalAgentRuns.get(requestId);
        if (!run) {
          sendResponse({ ok: false, errors: [`Result not found for requestId: ${requestId}`] });
          return;
        }
        if (run.senderId !== senderId) {
          sendResponse({ ok: false, errors: ["Not allowed to read this request result"] });
          return;
        }

        sendResponse({ ok: true, data: serializeExternalRun(run) });
        return;
      }

      if (message.type === "AGENT_EXTERNAL_COMMAND") {
        const senderId = resolveExternalSenderId(sender);
        if (!senderId) {
          sendResponse({ ok: false, errors: ["Only extension senders can call AGENT_EXTERNAL_COMMAND"] });
          return;
        }

        const payload = message.payload as AgentExternalCommandPayload | undefined;
        const userMessage = typeof payload?.userMessage === "string" ? payload.userMessage.trim() : "";
        if (!userMessage) {
          sendResponse({ ok: false, errors: ["userMessage is required"] });
          return;
        }

        const tabId = await resolveTabId(payload?.tabId);
        if (!tabId) {
          sendResponse({ ok: false, errors: ["tabId is required (or no active tab found)"] });
          return;
        }

        const requestId = typeof payload?.requestId === "string" && payload.requestId.trim()
          ? payload.requestId.trim()
          : `ext-agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const config = payload?.config ?? await repo.getConfig();
        const validation = validateConfig(config);
        if (!validation.valid) {
          sendResponse({ ok: false, errors: [`Invalid config: ${validation.errors.join("; ")}`] });
          return;
        }

        const runPayload: AgentRunConfig = {
          requestId,
          tabId,
          config,
          userMessage,
          history: payload?.history,
          maxIterations: typeof payload?.maxIterations === "number" ? payload.maxIterations : undefined,
          toolTimeout: typeof payload?.toolTimeout === "number" ? payload.toolTimeout : undefined
        };

        pruneExternalAgentRuns();
        externalAgentRuns.set(requestId, {
          requestId,
          senderId,
          tabId,
          userMessage,
          status: "running",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          assistantText: "",
          thinkingText: "",
          toolCalls: []
        });

        emitExternalAgentRunStarted({
          requestId,
          senderId,
          tabId,
          userMessage
        });

        sendResponse({
          ok: true,
          data: {
            requestId,
            senderId
          }
        });

        startAgentRun(runPayload);
        return;
      }

      if (message.type === "AGENT_RUN") {
        const payload = message.payload as AgentRunConfig | undefined;
        if (!payload?.requestId || !payload?.tabId || !payload?.config || !payload?.userMessage) {
          sendResponse({ ok: false, errors: ["Invalid AGENT_RUN payload"] });
          return;
        }

        sendResponse({ ok: true, data: { requestId: payload.requestId } });
        startAgentRun(payload);
        return;
      }

      if (message.type === "AGENT_CANCEL") {
        const payload = message.payload as { requestId?: string } | undefined;
        const rid = payload?.requestId;
        if (rid) {
          const controller = activeAgentControllers.get(rid);
          if (controller) {
            controller.abort();
            const run = externalAgentRuns.get(rid);
            if (run) {
              run.status = "error";
              run.error = "Agent cancelled";
              run.updatedAt = Date.now();
              run.finishedAt = Date.now();
            }
            sendResponse({ ok: true, data: { requestId: rid, canceled: true } });
          } else {
            sendResponse({ ok: true, data: { requestId: rid, canceled: false } });
          }
        } else {
          sendResponse({ ok: false, errors: ["requestId is required"] });
        }
        return;
      }

      sendResponse({ ok: false, errors: ["Unknown message type"] });
    })();

    return true;
  };
}

if (typeof chrome !== "undefined" && chrome.runtime) {
  const messageHandler = createBackgroundMessageHandler(chromeStorageAdapter);
  const connectHandler = createBackgroundConnectHandler(chromeStorageAdapter);
  if (chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(messageHandler);
  }
  if (chrome.runtime.onMessageExternal) {
    chrome.runtime.onMessageExternal.addListener(messageHandler);
  }
  if (chrome.runtime.onConnect) {
    chrome.runtime.onConnect.addListener(connectHandler);
  }
}

// ── Scheduled Task Alarm Helpers ──

import type { ScheduledTask } from "./shared/agentScheduler.js";

function describeTaskSchedule(task: { scheduleType: string; time: string; dayOfWeek?: number; intervalMinutes?: number }): string {
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  switch (task.scheduleType) {
    case "once": return `单次 ${task.time}`;
    case "interval": return `每 ${task.intervalMinutes} 分钟`;
    case "daily": return `每天 ${task.time}`;
    case "weekly": return `每${days[task.dayOfWeek ?? 0]} ${task.time}`;
    default: return task.scheduleType;
  }
}

async function registerTaskAlarm(task: ScheduledTask): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.alarms) return;
  const alarmName = getAlarmName(task.id);
  const params = computeAlarmParams(task);
  await chrome.alarms.create(alarmName, params);
}

async function unregisterTaskAlarm(taskId: string): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.alarms) return;
  const alarmName = getAlarmName(taskId);
  await chrome.alarms.clear(alarmName);
}

/** Re-register all enabled task alarms (called on service worker startup) */
async function restoreAllAlarms(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.alarms) return;
  const tasks = await getAllScheduledTasks(chromeStorageAdapter);
  for (const task of tasks) {
    if (task.enabled) {
      // Only for "once" tasks: skip if time has passed and was already run
      if (task.scheduleType === "once" && task.lastRunAt) continue;
      await registerTaskAlarm(task);
    }
  }
}

/** Handle an alarm firing — trigger the agent for the associated task */
async function handleAlarmFired(alarm: chrome.alarms.Alarm): Promise<void> {
  const taskId = parseAlarmName(alarm.name);
  if (!taskId) return;

  const task = await getScheduledTask(chromeStorageAdapter, taskId);
  if (!task || !task.enabled) return;

  // For "once" tasks, disable after firing
  if (task.scheduleType === "once") {
    await updateScheduledTask(chromeStorageAdapter, taskId, { enabled: false });
    await unregisterTaskAlarm(taskId);
  }

  // Get current active tab to use as context
  let tabId: number | undefined;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  } catch {
    // No tab available
  }

  if (!tabId) {
    await recordTaskRun(chromeStorageAdapter, taskId, "Failed: no active tab");
    return;
  }

  // Load config for agent
  const repo = new ConfigRepository(chromeStorageAdapter);
  const config = await repo.getConfig();

  const requestId = `sched-${taskId}-${Date.now()}`;

  // Run the agent loop (fire-and-forget, errors recorded)
  try {
    await runAgentLoop(
      {
        requestId,
        tabId,
        config,
        userMessage: `[定时任务自动触发] 任务: ${task.name}\n\n${task.instruction}`
      },
      {
        emit: (event: AgentProgressEvent) => {
          if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage(event).catch(() => {});
          }
        },
        executePageTool: async (tid, toolName, args) => {
          const response = await chrome.tabs.sendMessage(tid, {
            type: "AGENT_TOOL_EXECUTE",
            payload: { toolName, arguments: args }
          }) as { ok?: boolean; data?: string } | undefined;
          return {
            toolCallId: "",
            toolName,
            output: response?.ok
              ? (typeof response.data === "string" ? response.data : JSON.stringify(response.data))
              : `Tool execution failed: ${JSON.stringify(response)}`,
            isError: !response?.ok
          };
        },
        executeBackgroundTool: async (_tid, toolName, args) => {
          // Scheduled tasks can use navigate and memory tools but not create more tasks
          if (toolName === "navigate") {
            const url = typeof args.url === "string" ? args.url : "";
            if (!url) return { toolCallId: "", toolName, output: "Error: url is required", isError: true };
            try {
              await chrome.tabs.update(tabId!, { url });
              return { toolCallId: "", toolName, output: `Navigating to ${url}`, isError: false };
            } catch (error) {
              return { toolCallId: "", toolName, output: `Navigate failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
            }
          }
          if (toolName === "wait_for_url") {
            const urlPattern = typeof args.urlPattern === "string" ? args.urlPattern : "";
            const timeout = typeof args.timeout === "number" ? args.timeout : 5000;
            if (!urlPattern) return { toolCallId: "", toolName, output: "Error: urlPattern is required", isError: true };

            let matcher: RegExp;
            try {
              const regexMatch = /^\/(.+)\/([dgimsuvy]*)$/.exec(urlPattern.trim());
              if (regexMatch) matcher = new RegExp(regexMatch[1], regexMatch[2]);
              else matcher = new RegExp(urlPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
            } catch (error) {
              return { toolCallId: "", toolName, output: `Error: Invalid pattern - ${String(error)}`, isError: true };
            }

            try {
              const checkUrl = async () => {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tabs && tabs.length > 0) return tabs[0].url || "";
                return (await chrome.tabs.get(tabId!)).url || "";
              };
              const initialUrl = await checkUrl();
              if (matcher.test(initialUrl)) return { toolCallId: "", toolName, output: `URL matched: ${initialUrl}`, isError: false };

              return await new Promise<ToolResult>((resolve) => {
                const startTime = Date.now();
                const interval = setInterval(async () => {
                  try {
                    const currentUrl = await checkUrl();
                    if (matcher.test(currentUrl)) {
                      clearInterval(interval);
                      resolve({ toolCallId: "", toolName, output: `URL matched: ${currentUrl}`, isError: false });
                    } else if (Date.now() - startTime >= timeout) {
                      clearInterval(interval);
                      resolve({ toolCallId: "", toolName, output: `Timeout waiting for URL pattern: ${urlPattern}`, isError: false });
                    }
                  } catch (err) {
                    clearInterval(interval);
                    resolve({ toolCallId: "", toolName, output: `Error: ${String(err)}`, isError: true });
                  }
                }, 200);
              });
            } catch (error) {
              return { toolCallId: "", toolName, output: `wait_for_url failed: ${String(error)}`, isError: true };
            }
          }
          if (toolName === "get_current_time") {
            const now = new Date();
            const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            const info = {
              datetime: now.toLocaleString("zh-CN", { hour12: false }),
              iso: now.toISOString(),
              timestamp: now.getTime(),
              dayOfWeek: days[now.getDay()],
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            };
            return { toolCallId: "", toolName, output: JSON.stringify(info), isError: false };
          }
          if (toolName === "save_memory") {
            const content = typeof args.content === "string" ? args.content : "";
            if (!content) return { toolCallId: "", toolName, output: "Error: content is required", isError: true };
            const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
            const entry = await addMemory(chromeStorageAdapter, content, tags);
            // Auto-compress check
            const allMem = await getAllMemories(chromeStorageAdapter);
            if (needsCompression(allMem)) {
              try {
                const taskConfig = await chromeStorageAdapter.get<LLMConfig>("neonagent.config");
                if (taskConfig?.baseUrl && taskConfig?.apiKey) {
                  const callLLM = async (prompt: string): Promise<string> => {
                    return requestChatCompletion({ config: taskConfig, messages: [{ role: "user", content: prompt }] });
                  };
                  await compressMemories(chromeStorageAdapter, callLLM);
                }
              } catch { /* compression is best-effort */ }
            }
            return { toolCallId: "", toolName, output: `Memory saved (id: ${entry.id})`, isError: false };
          }
          if (toolName === "search_memories") {
            const query = typeof args.query === "string" ? args.query : "";
            const results = await searchMemories(chromeStorageAdapter, query);
            if (results.length === 0) return { toolCallId: "", toolName, output: "No memories found.", isError: false };
            const fmt = results.map((e) => `- [${e.id}] ${e.content}`).join("\n");
            return { toolCallId: "", toolName, output: `Found ${results.length} memories:\n${fmt}`, isError: false };
          }
          return { toolCallId: "", toolName, output: `Tool ${toolName} not available in scheduled tasks`, isError: true };
        },
        getMemories: () => getAllMemories(chromeStorageAdapter),
        getSkills: () => getAllSkills(chromeStorageAdapter)
      }
    );
    await recordTaskRun(chromeStorageAdapter, taskId, "Success");
  } catch (error) {
    await recordTaskRun(
      chromeStorageAdapter,
      taskId,
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Register alarm listener and restore alarms on startup
if (typeof chrome !== "undefined" && chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    void handleAlarmFired(alarm);
  });

  // Restore alarms when service worker wakes up
  void restoreAllAlarms();
}

// Click extension icon to toggle side panel
if (typeof chrome !== "undefined" && chrome.sidePanel) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
