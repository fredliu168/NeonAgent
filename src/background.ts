import { validateConfig } from "./shared/config.js";
import { chromeStorageAdapter } from "./shared/chromeStorageAdapter.js";
import { ChatHistoryRepository, ConfigRepository, AgentHistoryRepository } from "./shared/storage.js";
import { isRuntimeMessage } from "./shared/messageGuards.js";
import {
  requestChatCompletion,
  requestChatCompletionStream
} from "./shared/llmClient.js";
import { runAgentLoop } from "./shared/agentLoop.js";
import type { AgentProgressEvent, AgentRunConfig, AgentSession, ToolResult } from "./shared/agentTypes.js";
import type { ChatSession, LLMConfig } from "./shared/types.js";
import type { RuntimeStreamEvent } from "./shared/types.js";
import type { StorageLike } from "./shared/storage.js";
import { addMemory, searchMemories, deleteMemory, getAllMemories, importMemories, compressMemories, needsCompression } from "./shared/agentMemory.js";
import {
  createSkill, listSkills, executeSkill, updateSkill, deleteSkill,
  getAllSkills, getSkillById, importSkills, formatSkillForExecution
} from "./shared/agentSkills.js";
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

interface BackgroundDependencies {
  invokeLLM?: typeof requestChatCompletion;
  invokeLLMStream?: typeof requestChatCompletionStream;
  emitStreamEvent?: (event: RuntimeStreamEvent) => void | Promise<void>;
  emitAgentEvent?: (event: AgentProgressEvent) => void | Promise<void>;
  sendTabMessage?: (tabId: number, message: unknown) => Promise<unknown>;
  /** Override sandbox execution for testing (bypasses offscreen document) */
  executeInSandbox?: (code: string, toolName: string, args: Record<string, unknown>, envVars: Record<string, string>) => Promise<string>;
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

export function createBackgroundMessageHandler(storage: StorageLike, deps: BackgroundDependencies = {}) {
  const repo = new ConfigRepository(storage);
  const chatRepo = new ChatHistoryRepository(storage);
  const agentRepo = new AgentHistoryRepository(storage);
  const invokeLLM = deps.invokeLLM ?? requestChatCompletion;
  const invokeLLMStream = deps.invokeLLMStream ?? requestChatCompletionStream;
  const runInSandbox = deps.executeInSandbox ?? executeScriptInSandbox;
  const activeStreamControllers = new Map<string, AbortController>();
  const emitStreamEvent =
    deps.emitStreamEvent ??
    ((event: RuntimeStreamEvent) => {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(event).catch(() => {/* receiver not ready */});
      }
    });

  const emitAgentEvent =
    deps.emitAgentEvent ??
    ((event: AgentProgressEvent) => {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(event).catch(() => {/* receiver not ready */});
      }
    });

  const sendTabMessage =
    deps.sendTabMessage ??
    ((tabId: number, msg: unknown) => {
      if (typeof chrome !== "undefined" && chrome.tabs?.sendMessage) {
        return chrome.tabs.sendMessage(tabId, msg);
      }
      return Promise.reject(new Error("chrome.tabs.sendMessage not available"));
    });

  const activeAgentControllers = new Map<string, AbortController>();

  return (message: { type?: string; payload?: unknown }, _sender: unknown, sendResponse: (response: unknown) => void) => {
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

      if (message.type === "SAVE_CONFIG") {
        const config = message.payload as LLMConfig;
        const validation = validateConfig(config);
        if (!validation.valid) {
          sendResponse({ ok: false, errors: validation.errors });
          return;
        }

        await repo.saveConfig(config);
        sendResponse({ ok: true });
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

      if (isRuntimeMessage(message) && message.type === "LLM_REQUEST") {
        try {
          const content = await invokeLLM({
            config: message.payload.config,
            messages: message.payload.messages,
            pageContext: message.payload.pageContext
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
            pageContext: message.payload.pageContext,
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

      if (message.type === "AGENT_RUN") {
        const payload = message.payload as AgentRunConfig | undefined;
        if (!payload?.requestId || !payload?.tabId || !payload?.config || !payload?.userMessage) {
          sendResponse({ ok: false, errors: ["Invalid AGENT_RUN payload"] });
          return;
        }

        sendResponse({ ok: true, data: { requestId: payload.requestId } });

        const controller = new AbortController();
        activeAgentControllers.set(payload.requestId, controller);

        void (async () => {
          try {
            await runAgentLoop(
              payload,
              {
                emit: emitAgentEvent,
                executePageTool: async (tabId, toolName, args) => {
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
                },
                executeBackgroundTool: async (tabId, toolName, args) => {
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
                      if (needsCompression(allMem) && payload.config.baseUrl && payload.config.apiKey) {
                        const callLLM = async (prompt: string): Promise<string> => {
                          return invokeLLM({ config: payload.config, messages: [{ role: "user", content: prompt }] });
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

                  // ── Skill Tools ──

                  if (toolName === "create_skill") {
                    const name = typeof args.name === "string" ? args.name : "";
                    const description = typeof args.description === "string" ? args.description : "";
                    const steps = Array.isArray(args.steps) ? args.steps.map(String) : [];
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

                  if (toolName === "update_skill") {
                    const skillId = typeof args.skillId === "string" ? args.skillId : "";
                    if (!skillId) {
                      return { toolCallId: "", toolName, output: "Error: skillId is required", isError: true };
                    }
                    const updates: { name?: string; description?: string; steps?: string[]; tags?: string[] } = {};
                    if (typeof args.name === "string") updates.name = args.name;
                    if (typeof args.description === "string") updates.description = args.description;
                    if (Array.isArray(args.steps)) updates.steps = args.steps.map(String);
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
                },
                getPageContext: async (tabId) => {
                  try {
                    const resp = await sendTabMessage(tabId, { type: "GET_PAGE_CONTEXT" }) as { ok?: boolean; data?: string } | undefined;
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
          } finally {
            activeAgentControllers.delete(payload.requestId);
          }
        })();
        return;
      }

      if (message.type === "AGENT_CANCEL") {
        const payload = message.payload as { requestId?: string } | undefined;
        const rid = payload?.requestId;
        if (rid) {
          const controller = activeAgentControllers.get(rid);
          if (controller) {
            controller.abort();
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

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(createBackgroundMessageHandler(chromeStorageAdapter));
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