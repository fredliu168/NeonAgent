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
  ToolResult
} from "./agentTypes.js";
import { AGENT_TOOL_DEFINITIONS, BACKGROUND_TOOLS, PAGE_TOOLS } from "./agentTools.js";
import { buildAgentSystemPrompt } from "./agentSystemPrompt.js";
import { requestAgentStream } from "./agentLlmClient.js";
import type { MemoryEntry } from "./agentMemory.js";
import { formatMemoriesForPrompt } from "./agentMemory.js";
import type { Skill } from "./agentSkills.js";
import { formatSkillsForPrompt } from "./agentSkills.js";
import type { ScheduledTask } from "./agentScheduler.js";
import { formatScheduledTasksForPrompt } from "./agentScheduler.js";

const DEFAULT_MAX_ITERATIONS = 100;

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

  const promptContext = (pageContext || memoriesPrompt || skillsPrompt || tasksPrompt)
    ? {
        pageUrl: pageContext?.url,
        pageTitle: pageContext?.title,
        memories: memoriesPrompt,
        skills: skillsPrompt,
        scheduledTasks: tasksPrompt
      }
    : undefined;

  messages.push({
    role: "system",
    content: buildAgentSystemPrompt(promptContext)
  });

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
      streamResult = await requestAgentStream(
        {
          config: config.config,
          messages,
          tools: AGENT_TOOL_DEFINITIONS,
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

        if (PAGE_TOOLS.has(toolName)) {
          result = await withTimeout(
            deps.executePageTool(config.tabId, toolName, args),
            config.toolTimeout ?? 30000,
            `Tool ${toolName} timed out`
          );
        } else if (BACKGROUND_TOOLS.has(toolName)) {
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
        content: result.output
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
