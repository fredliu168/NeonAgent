import { DEFAULT_CONFIG, migrateConfig, validateConfig } from "../shared/config.js";
import { matchAnswersFromText } from "../shared/examAssistant.js";
import {
  createLLMStreamCancelMessage,
  createLLMStreamRequestMessage
} from "../shared/messages.js";
import { skillToMarkdown, parseSkillMarkdown, skillsToMarkdown, parseSkillsMarkdown } from "../shared/agentSkills.js";
import { memoriesToMarkdown, parseMemoriesMarkdown } from "../shared/agentMemory.js";
import type { ChatSession, ExamQuestion, LLMConfig, RuntimeStreamEvent } from "../shared/types.js";
import type { AgentProgressEvent } from "../shared/agentTypes.js";
import type { AgentSession } from "../shared/agentTypes.js";
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

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el as T;
}

const baseUrlInput = byId<HTMLInputElement>("baseUrl");
const apiKeyInput = byId<HTMLInputElement>("apiKey");
const modelInput = byId<HTMLSelectElement>("model");
const newModelInput = byId<HTMLInputElement>("newModel");
const addModelBtn = byId<HTMLButtonElement>("addModel");
const removeModelBtn = byId<HTMLButtonElement>("removeModel");
const agentMaxTokensInput = byId<HTMLInputElement>("agentMaxTokens");
const unlockContextMenuInput = byId<HTMLInputElement>("unlockContextMenu");
const blockVisibilityDetectionInput = byId<HTMLInputElement>("blockVisibilityDetection");
const aggressiveVisibilityBypassInput = byId<HTMLInputElement>("aggressiveVisibilityBypass");
const statusEl = byId<HTMLDivElement>("status");
const injectionNoticeEl = byId<HTMLDivElement>("injectionNotice");
const contextEl = byId<HTMLPreElement>("context");
const chatInput = byId<HTMLInputElement>("chatInput");
const chatStatusEl = byId<HTMLDivElement>("chatStatus");
const chatMessagesEl = byId<HTMLDivElement>("chatMessages");
const examStatusEl = byId<HTMLDivElement>("examStatus");
const chatSessionsEl = byId<HTMLDivElement>("chatSessions");
const askAndAutoFillBtn = byId<HTMLButtonElement>("askAndAutoFill");

// ── Agent DOM elements ──
const agentMessagesEl = byId<HTMLDivElement>("agentMessages");
const agentStatusEl = byId<HTMLDivElement>("agentStatus");
const agentInput = byId<HTMLInputElement>("agentInput");
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

async function getCurrentTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function injectContentScript(tabId: number): Promise<void> {
  if (!chrome.scripting?.executeScript) {
    return;
  }

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
}

function appendChatMessageDOM(msg: { role: string; content: string; thinking?: string }, isLast: boolean): void {
  const thinking = (msg as { thinking?: string }).thinking;

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
    const last = msgs[msgs.length - 1] as { role: string; content: string; thinking?: string };
    if (last.role === "assistant") {
      // Update thinking in-place
      const thinking = last.thinking;
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
  return {
    baseUrl: baseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value,
    models: [...currentModels],
    temperature: DEFAULT_CONFIG.temperature,
    maxTokens: DEFAULT_CONFIG.maxTokens,
    agentMaxTokens: parseInt(agentMaxTokensInput.value, 10) || DEFAULT_CONFIG.agentMaxTokens,
    systemPrompt: DEFAULT_CONFIG.systemPrompt,
    unlockContextMenu: unlockContextMenuInput.checked,
    blockVisibilityDetection: blockVisibilityDetectionInput.checked,
    aggressiveVisibilityBypass: aggressiveVisibilityBypassInput.checked,
    enableFloatingBall: DEFAULT_CONFIG.enableFloatingBall
  };
}

function renderModelSelect(selected?: string): void {
  modelInput.innerHTML = "";
  for (const m of currentModels) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    modelInput.appendChild(opt);
  }
  if (selected && currentModels.includes(selected)) {
    modelInput.value = selected;
  } else if (currentModels.length > 0) {
    modelInput.value = currentModels[0];
  }
}

function toFeatureFlags(config: LLMConfig) {
  return {
    unlockContextMenu: config.unlockContextMenu,
    blockVisibilityDetection: config.blockVisibilityDetection,
    aggressiveVisibilityBypass: config.aggressiveVisibilityBypass,
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
  baseUrlInput.value = config.baseUrl;
  apiKeyInput.value = config.apiKey;
  currentModels = Array.isArray(config.models) && config.models.length > 0
    ? config.models
    : [config.model || DEFAULT_CONFIG.model];
  renderModelSelect(config.model);
  agentMaxTokensInput.value = String(config.agentMaxTokens ?? DEFAULT_CONFIG.agentMaxTokens);
  unlockContextMenuInput.checked = config.unlockContextMenu;
  blockVisibilityDetectionInput.checked = config.blockVisibilityDetection;
  aggressiveVisibilityBypassInput.checked = config.aggressiveVisibilityBypass;
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
}

async function saveConfig(): Promise<void> {
  const config = toConfig();
  const response = await chrome.runtime.sendMessage({
    type: "SAVE_CONFIG",
    payload: config
  });

  if (!response?.ok) {
    const message = Array.isArray(response?.errors)
      ? response.errors.join(", ")
      : "Save config failed";
    setStatus(message, true);
    return;
  }

  try {
    await applyConfigToActiveTab(config);
  } catch {
    // ignored
  }

  setStatus("Config saved");
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
      baseUrlInput.value = config.baseUrl;
      apiKeyInput.value = config.apiKey;
      currentModels = [...config.models];
      renderModelSelect(config.model);
      agentMaxTokensInput.value = String(config.agentMaxTokens ?? DEFAULT_CONFIG.agentMaxTokens);
      unlockContextMenuInput.checked = config.unlockContextMenu;
      blockVisibilityDetectionInput.checked = config.blockVisibilityDetection;
      aggressiveVisibilityBypassInput.checked = config.aggressiveVisibilityBypass;

      try {
        await applyConfigToActiveTab(config);
      } catch {
        // ignored
      }

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
        config: toConfig(),
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

async function detectExamQuestions(): Promise<void> {
  await detectExamQuestionsInternal();
}

async function detectExamQuestionsInternal(): Promise<ExamQuestion[]> {
  const tabId = await getCurrentTabId();
  if (!tabId) {
    setExamStatus("No active tab for question parsing.");
    return [];
  }

  const response = await sendTabMessageWithAutoInject(tabId, { type: "GET_EXAM_QUESTIONS" });
  if (!response.response?.ok) {
    setExamStatus("Question parsing failed on current page.");
    return [];
  }

  const questions = ((response.response.data as ExamQuestion[] | undefined) ?? []).filter(
    (item) => item && typeof item.id === "string" && Array.isArray(item.options)
  );
  latestExamQuestions = questions;

  if (questions.length === 0) {
    setExamStatus("No questions detected.");
    return [];
  }

  setExamStatus(`Detected ${questions.length} question(s).`);
  contextEl.textContent = formatQuestionsForPrompt(questions);
  return questions;
}

async function autoFillExamAnswers(): Promise<void> {
  if (latestExamQuestions.length === 0) {
    setExamStatus("Parse questions first.");
    return;
  }

  const tabId = await getCurrentTabId();
  if (!tabId) {
    setExamStatus("No active tab for auto fill.");
    return;
  }

  const lastAssistantMsg = [...chatState.messages].reverse().find((message) => message.role === "assistant");
  const content = lastAssistantMsg?.content ?? "";
  const thinking = (lastAssistantMsg as { thinking?: string } | undefined)?.thinking ?? "";
  const assistantAnswer = content.trim() ? content : thinking;
  if (!assistantAnswer.trim()) {
    setExamStatus("No assistant answer to map.");
    return;
  }

  // Try matching from content first, then thinking, then combined
  let matches = matchAnswersFromText(latestExamQuestions, assistantAnswer);
  if (matches.length === 0 && content.trim() && thinking.trim()) {
    matches = matchAnswersFromText(latestExamQuestions, thinking);
  }
  if (matches.length === 0 && thinking.trim() && assistantAnswer !== thinking) {
    matches = matchAnswersFromText(latestExamQuestions, thinking);
  }
  if (matches.length === 0) {
    setExamStatus("No valid answer labels matched.");
    return;
  }

  const response = await sendTabMessageWithAutoInject(tabId, {
    type: "APPLY_EXAM_ANSWERS",
    payload: { matches }
  });

  if (!response.response?.ok) {
    setExamStatus("Auto fill failed on current page.");
    return;
  }

  const applied = (response.response.data as { applied?: number } | undefined)?.applied ?? 0;
  setExamStatus(`Auto filled ${applied} question(s).`);
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

async function askAndAutoFill(): Promise<void> {
  askAndAutoFillBtn.disabled = true;
  try {
    const questions = await detectExamQuestionsInternal();
    if (questions.length === 0) {
      return;
    }

    setExamStatus("Asking assistant for answers...");
    const success = await sendChatMessageWithContent(buildExamPrompt(questions), {
      includePageContext: false
    });
    if (!success) {
      setExamStatus("Ask step failed.");
      return;
    }

    await autoFillExamAnswers();
  } finally {
    askAndAutoFillBtn.disabled = false;
  }
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
  }
}

// ── Agent Functions ──

function setAgentStatus(text: string): void {
  agentStatusEl.textContent = text;
}

function renderAgent(): void {
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
    agentIterInfoEl.textContent = `迭代 ${event.payload.iteration} / ${event.payload.maxIterations}`;
    return;
  }

  if (event.type === "AGENT_TURN_COMPLETE") {
    agentPending = false;
    activeAgentRequestId = null;
    agentIterInfoEl.textContent = `完成 (${event.payload.iterations} 轮迭代)`;
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

async function sendAgentMessage(): Promise<void> {
  const input = agentInput.value.trim();
  agentInput.value = "";
  if (!input) return;

  const tabId = await getCurrentTabId();
  if (!tabId) {
    setAgentStatus("没有可用的标签页，智能体无法操作。");
    return;
  }

  agentEntries.push({ type: "user", content: input });
  agentPending = true;
  renderAgent();
  scheduleAgentPersist();

  const requestId = `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  activeAgentRequestId = requestId;
  agentIterInfoEl.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "AGENT_RUN",
      payload: {
        requestId,
        tabId,
        config: toConfig(),
        userMessage: input,
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
  agentIterInfoEl.textContent = "";
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
      agentIterInfoEl.textContent = "";
      renderAgentSessions();
      renderAgent();
    });
    agentSessionsEl.appendChild(btn);
  }
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
    messages: [],
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
  agentIterInfoEl.textContent = "";
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
  agentIterInfoEl.textContent = "";
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
  agentIterInfoEl.textContent = "";
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

  if (isAgentEvent(type)) {
    handleAgentEvent(message as AgentProgressEvent);
    return;
  }
}

byId<HTMLButtonElement>("saveConfig").addEventListener("click", () => {
  void saveConfig();
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
  renderModelSelect(name);
});

removeModelBtn.addEventListener("click", () => {
  const selected = modelInput.value;
  if (!selected) return;
  if (currentModels.length <= 1) {
    setStatus("至少保留一个模型", true);
    return;
  }
  currentModels = currentModels.filter((m) => m !== selected);
  renderModelSelect();
});

byId<HTMLButtonElement>("exportConfig").addEventListener("click", () => {
  void exportConfig();
});

byId<HTMLButtonElement>("importConfigBtn").addEventListener("click", () => {
  triggerImportConfig();
});

byId<HTMLButtonElement>("loadContext").addEventListener("click", () => {
  void loadPageContext();
});

byId<HTMLButtonElement>("sendChat").addEventListener("click", () => {
  void sendChatMessage();
});

byId<HTMLButtonElement>("stopChat").addEventListener("click", () => {
  void stopChatMessage();
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
byId<HTMLButtonElement>("sendAgent").addEventListener("click", () => {
  void sendAgentMessage();
});

byId<HTMLButtonElement>("stopAgent").addEventListener("click", () => {
  void stopAgent();
});

byId<HTMLButtonElement>("clearAgent").addEventListener("click", () => {
  clearAgent();
  scheduleAgentPersist();
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

byId<HTMLButtonElement>("toggleMemories").addEventListener("click", () => {
  const isHidden = memoriesPanelEl.hidden;
  memoriesPanelEl.hidden = !isHidden;
  if (isHidden) void loadMemoriesList();
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

byId<HTMLButtonElement>("toggleSkills").addEventListener("click", () => {
  const isHidden = skillsPanelEl.hidden;
  skillsPanelEl.hidden = !isHidden;
  if (isHidden) void loadSkillsList();
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

byId<HTMLButtonElement>("toggleTasks").addEventListener("click", () => {
  const isHidden = tasksPanelEl.hidden;
  tasksPanelEl.hidden = !isHidden;
  if (isHidden) void loadTasksList();
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

    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(targetId)?.classList.add("active");
  });
});

chrome.runtime.onMessage.addListener((message) => {
  maybeHandleRuntimeMessage(message);
});

void loadConfig();
void loadChatSessions();
void loadAgentSessions();