/**
 * Core agent loop — follows the claw-code/rust architecture:
 * User message → LLM call (with tools) → extract tool_calls →
 * execute tools → feed results back → loop until no tool calls.
 */

import type {
  AgentMessage,
  AgentProgressEvent,
  AgentRunConfig,
  ToolCall,
  ToolDefinition,
  ToolResult
} from "./agentTypes.js";
import { AGENT_TOOL_DEFINITIONS, BACKGROUND_TOOLS, PAGE_TOOLS, CORE_TOOLS, TOOL_CATEGORIES, type ToolCategory } from "./agentTools.js";
import { buildAgentSystemPrompt } from "./agentSystemPrompt.js";
import { requestAgentStream } from "./agentLlmClient.js";
import { getInputTokenBudget, trimGroupedArrayToEstimatedTokenBudget } from "./tokenBudget.js";
import type { MemoryEntry } from "./agentMemory.js";
import { formatMemoriesForPrompt } from "./agentMemory.js";
import type { Skill } from "./agentSkills.js";
import { formatSkillsForPrompt } from "./agentSkills.js";
import type { ScheduledTask } from "./agentScheduler.js";
import { formatScheduledTasksForPrompt } from "./agentScheduler.js";
import type { ScriptSkill } from "./agentScriptSkill.js";
import { formatScriptSkillsForPrompt, generateScriptSkillToolDefs, getScriptSkillToolNames } from "./agentScriptSkill.js";

const DEFAULT_MAX_ITERATIONS = 100;
const TOOL_RESULT_MODEL_OUTPUT_LIMIT = 1200;

export interface AgentLoopDeps {
  /** Emit a progress event to the UI (sidepanel) */
  emit: (event: AgentProgressEvent) => void | Promise<void>;
  /** Execute a tool on the content script (page) */
  executePageTool: (
    tabId: number,
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<ToolResult>;
  /** Execute a tool in the background (e.g. navigate) */
  executeBackgroundTool: (
    tabId: number,
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<ToolResult>;
  /** Get page info for system prompt context */
  getPageContext?: (tabId: number) => Promise<{ url?: string; title?: string }>;
  /** Load all saved memories for system prompt injection */
  getMemories?: () => Promise<MemoryEntry[]>;
  /** Load all saved skills for system prompt injection */
  getSkills?: () => Promise<Skill[]>;
  /** Load all scheduled tasks for system prompt injection */
  getScheduledTasks?: () => Promise<ScheduledTask[]>;
  /** Load all installed script skills for dynamic tool injection */
  getScriptSkills?: () => Promise<ScriptSkill[]>;
  /** Optional: custom fetch for testing */
  fetcher?: typeof fetch;
}

/**
 * Run the agent loop. Continues until the LLM responds with only text
 * (no tool calls) or max iterations are reached.
 */
export async function runAgentLoop(
  config: AgentRunConfig,
  deps: AgentLoopDeps,
  signal?: AbortSignal
): Promise<void> {
  const maxIter = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // Build initial messages
  const messages: AgentMessage[] = [];

  // System prompt
  let pageContext: { url?: string; title?: string } | undefined;
  if (deps.getPageContext) {
    try {
      pageContext = await deps.getPageContext(config.tabId);
    } catch {
      // Can't get page context, proceed without it
    }
  }

  // Load memories for context injection
  let memoriesPrompt: string | undefined;
  if (deps.getMemories) {
    try {
      const memories = await deps.getMemories();
      const formatted = formatMemoriesForPrompt(memories);
      if (formatted) memoriesPrompt = formatted;
    } catch {
      // Can't load memories, proceed without them
    }
  }

  // Load skills for context injection
  let skillsPrompt: string | undefined;
  if (deps.getSkills) {
    try {
      const skills = await deps.getSkills();
      const formatted = formatSkillsForPrompt(skills);
      if (formatted) skillsPrompt = formatted;
    } catch {
      // Can't load skills, proceed without them
    }
  }

  // Load scheduled tasks for context injection
  let tasksPrompt: string | undefined;
  if (deps.getScheduledTasks) {
    try {
      const tasks = await deps.getScheduledTasks();
      const formatted = formatScheduledTasksForPrompt(tasks);
      if (formatted) tasksPrompt = formatted;
    } catch {
      // Can't load tasks, proceed without them
    }
  }

  // Load script skills for dynamic tool injection
  let scriptSkills: ScriptSkill[] = [];
  let scriptSkillsPrompt: string | undefined;
  if (deps.getScriptSkills) {
    try {
      scriptSkills = await deps.getScriptSkills();
      const formatted = formatScriptSkillsForPrompt(scriptSkills);
      if (formatted) scriptSkillsPrompt = formatted;
    } catch {
      // Can't load script skills, proceed without them
    }
  }

  // Generate dynamic tool definitions from script skills
  const scriptSkillToolDefs = generateScriptSkillToolDefs(scriptSkills);
  const scriptSkillToolNameSet = getScriptSkillToolNames(scriptSkills);
  const allToolDefs = [...AGENT_TOOL_DEFINITIONS, ...scriptSkillToolDefs];
  const currentToolDefs = allToolDefs.filter(t => CORE_TOOLS.has(t.function.name));
  const loadedCategories = new Set<string>(
    (config.initialLoadedToolCategories ?? []).filter((category) => typeof category === "string" && category)
  );
  hydrateToolDefinitionsForLoadedCategories({
    currentToolDefs,
    allToolDefs,
    loadedCategories,
    scriptSkillToolNameSet
  });


  const promptContext = (pageContext || memoriesPrompt || skillsPrompt || tasksPrompt || scriptSkillsPrompt)
    ? {
        pageUrl: pageContext?.url,
        pageTitle: pageContext?.title,
        memories: memoriesPrompt,
        skills: skillsPrompt,
        scheduledTasks: tasksPrompt,
        scriptSkills: scriptSkillsPrompt
      }
    : undefined;

  messages.push({
    role: "system",
    content: buildAgentSystemPrompt(promptContext)
  });

  if (config.referenceContext?.trim()) {
    messages.push({
      role: "system",
      content: [
        "Reference workbook context (prioritize this when the user's request is related):",
        config.referenceContext.trim()
      ].join("\n")
    });
  }

  // Restore history if any
  if (config.history && config.history.length > 0) {
    for (const msg of config.history) {
      if (msg.role !== "system") {
        messages.push(msg);
      }
    }
  }

  // Add the new user message
  messages.push({ role: "user", content: config.userMessage });

  // Agent loop
  for (let iteration = 0; iteration < maxIter; iteration++) {
    // Emit iteration start event for real-time UI tracking
    await deps.emit({
      type: "AGENT_ITERATION_START",
      payload: {
        requestId: config.requestId,
        iteration: iteration + 1,
        maxIterations: maxIter
      }
    });

    if (signal?.aborted) {
      await deps.emit({
        type: "AGENT_ERROR",
        payload: { requestId: config.requestId, error: "Agent cancelled" }
      });
      return;
    }

    // 1. Call LLM with tools (streaming)
    let streamResult;
    try {
      const requestMessages = trimGroupedArrayToEstimatedTokenBudget({
        items: messages,
        headCount: messages[0]?.role === "system" ? 1 : 0,
        budgetTokens: getInputTokenBudget({
          configuredMaxTokens: config.config.agentMaxTokens,
          model: config.config.model
        }),
        estimatePayload: (trimmedMessages) => ({
          messages: trimmedMessages,
          tools: currentToolDefs
        }),
        groupTailItems: groupAgentMessagesByTurn
      });

      streamResult = await requestAgentStream(
        {
          config: config.config,
          messages: requestMessages,
          tools: currentToolDefs,
          signal
        },
        {
          onTextDelta: (delta) => {
            void deps.emit({
              type: "AGENT_TEXT_DELTA",
              payload: { requestId: config.requestId, delta }
            });
          },
          onThinkingDelta: (delta) => {
            void deps.emit({
              type: "AGENT_THINKING_DELTA",
              payload: { requestId: config.requestId, delta }
            });
          },
          onToolCallStart: (_index, id, name) => {
            void deps.emit({
              type: "AGENT_TOOL_CALL",
              payload: {
                requestId: config.requestId,
                toolCallId: id,
                name,
                arguments: "(streaming...)"
              }
            });
          }
        },
        deps.fetcher
      );
    } catch (error) {
      if (signal?.aborted) return;
      await deps.emit({
        type: "AGENT_ERROR",
        payload: {
          requestId: config.requestId,
          error: error instanceof Error ? error.message : "LLM request failed"
        }
      });
      return;
    }

    // 2. Build assistant message and add to history
    const assistantMsg: AgentMessage = {
      role: "assistant",
      content: streamResult.content || null,
      reasoning_content: streamResult.thinking || undefined,
      tool_calls:
        streamResult.toolCalls.length > 0 ? streamResult.toolCalls : undefined
    };
    messages.push(assistantMsg);

    // 3. If no tool calls → turn complete
    if (streamResult.toolCalls.length === 0) {
      await deps.emit({
        type: "AGENT_TURN_COMPLETE",
        payload: { requestId: config.requestId, iterations: iteration + 1 }
      });
      return;
    }

    // 4. Emit finalized tool calls with arguments
    for (const tc of streamResult.toolCalls) {
      await deps.emit({
        type: "AGENT_TOOL_CALL",
        payload: {
          requestId: config.requestId,
          toolCallId: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      });
    }

    // 5. Execute each tool call
    for (const tc of streamResult.toolCalls) {
      if (signal?.aborted) return;

      let result: ToolResult;
      try {
        const args = safeParseArgs(tc.function.arguments);
        const toolName = tc.function.name;

        if (toolName === "load_tool_category") {
          const category = String(args.category);
          if (!TOOL_CATEGORIES[category as ToolCategory]) {
            result = {
              toolCallId: tc.id,
              toolName,
              output: `Error: Unknown category '${category}'. Available: ${Object.keys(TOOL_CATEGORIES).join(", ")}`,
              isError: true
            };
          } else if (loadedCategories.has(category)) {
            result = { toolCallId: tc.id, toolName, output: `Category '${category}' is already loaded.`, isError: false };
          } else {
            loadedCategories.add(category);
            hydrateToolDefinitionsForLoadedCategories({
              currentToolDefs,
              allToolDefs,
              loadedCategories,
              scriptSkillToolNameSet
            });
            result = {
              toolCallId: tc.id,
              toolName,
              output: `Successfully loaded tools for category '${category}'. Tool definitions are now available in the next turn.`,
              isError: false
            };
          }
        } else if (PAGE_TOOLS.has(toolName)) {
          result = await withTimeout(
            deps.executePageTool(config.tabId, toolName, args),
            config.toolTimeout ?? 30000,
            `Tool ${toolName} timed out`
          );
        } else if (BACKGROUND_TOOLS.has(toolName) || scriptSkillToolNameSet.has(toolName)) {
          result = await withTimeout(
            deps.executeBackgroundTool(config.tabId, toolName, args),
            config.toolTimeout ?? 30000,
            `Tool ${toolName} timed out`
          );
        } else {
          result = {
            toolCallId: tc.id,
            toolName: tc.function.name,
            output: `Unknown tool: ${tc.function.name}`,
            isError: true
          };
        }
      } catch (error) {
        result = {
          toolCallId: tc.id,
          toolName: tc.function.name,
          output: error instanceof Error ? error.message : "Tool execution error",
          isError: true
        };
      }

      // Emit tool result
      await deps.emit({
        type: "AGENT_TOOL_RESULT",
        payload: {
          requestId: config.requestId,
          toolCallId: tc.id,
          name: tc.function.name,
          result: result.output,
          isError: result.isError
        }
      });

      // Add tool result to messages for next LLM call
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result.modelOutput ?? summarizeToolOutputForModel(result)
      });
    }

    // Loop continues — LLM gets tool results and decides next action
  }

  // Max iterations reached
  await deps.emit({
    type: "AGENT_ERROR",
    payload: {
      requestId: config.requestId,
      error: `Agent reached maximum iterations (${maxIter}). Stopping.`
    }
  });
}

function hydrateToolDefinitionsForLoadedCategories(input: {
  currentToolDefs: ToolDefinition[];
  allToolDefs: ToolDefinition[];
  loadedCategories: Set<string>;
  scriptSkillToolNameSet: Set<string>;
}): void {
  for (const category of input.loadedCategories) {
    const toolsToAdd = TOOL_CATEGORIES[category as ToolCategory];
    if (!toolsToAdd) continue;
    for (const toolName of toolsToAdd) {
      const def = input.allToolDefs.find((candidate) => candidate.function.name === toolName);
      if (def && !input.currentToolDefs.some((candidate) => candidate.function.name === toolName)) {
        input.currentToolDefs.push(def);
      }
    }
    if (category === "script_skill") {
      for (const def of input.allToolDefs) {
        if (
          input.scriptSkillToolNameSet.has(def.function.name) &&
          !input.currentToolDefs.some((candidate) => candidate.function.name === def.function.name)
        ) {
          input.currentToolDefs.push(def);
        }
      }
    }
  }
}

function summarizeToolOutputForModel(result: ToolResult): string {
  const prefix = result.isError ? `[tool:${result.toolName}] error` : `[tool:${result.toolName}] ok`;
  const raw = typeof result.output === "string" ? result.output.trim() : "";
  if (!raw) {
    return `${prefix}: (empty result)`;
  }

  const compact = raw.replace(/\s+/g, " ").trim();
  const parsed = tryParseJson(raw);
  if (parsed !== null) {
    const jsonSummary = summarizeJsonValue(parsed);
    return `${prefix}: ${truncateForModel(jsonSummary, TOOL_RESULT_MODEL_OUTPUT_LIMIT)}`;
  }

  if (compact.length <= TOOL_RESULT_MODEL_OUTPUT_LIMIT) {
    return `${prefix}: ${compact}`;
  }

  const head = compact.slice(0, 800);
  const tail = compact.slice(-250);
  return `${prefix}: ${head} ... [truncated ${compact.length - 1050} chars] ... ${tail}`;
}

function tryParseJson(input: string): unknown | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function summarizeJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    const preview = value.slice(0, 3).map((item) => summarizeJsonValue(item));
    return `JSON array(length=${value.length}) ${preview.join(" | ")}`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const preview = keys.slice(0, 6).map((key) => `${key}=${summarizeJsonPrimitive(record[key])}`);
    return `JSON object(keys=${keys.length}) ${preview.join(", ")}`;
  }
  return summarizeJsonPrimitive(value);
}

function summarizeJsonPrimitive(value: unknown): string {
  if (typeof value === "string") {
    return truncateForModel(value.replace(/\s+/g, " ").trim(), 160);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value && typeof value === "object") {
    return `object(${Object.keys(value as Record<string, unknown>).length})`;
  }
  return typeof value;
}

function truncateForModel(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 24))} ... [truncated ${text.length - limit} chars]`;
}

function groupAgentMessagesByTurn(messages: AgentMessage[]): AgentMessage[][] {
  const groups: AgentMessage[][] = [];
  let currentGroup: AgentMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = [message];
      continue;
    }

    if (currentGroup.length === 0) {
      currentGroup = [message];
    } else {
      currentGroup.push(message);
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function safeParseArgs(argsStr: string): Record<string, unknown> {
  if (!argsStr || argsStr.trim() === "") return {};
  try {
    return JSON.parse(argsStr) as Record<string, unknown>;
  } catch {
    return { _raw: argsStr };
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
