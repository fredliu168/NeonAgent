import type { LLMConfig } from "./types.js";

// ── OpenAI Function Calling Types ──

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// ── Agent Message (OpenAI compatible with tool support) ──

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

// ── Tool Execution ──

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
}

// ── Agent Run Configuration ──

export interface AgentRunConfig {
  requestId: string;
  tabId: number;
  config: LLMConfig;
  userMessage: string;
  history?: AgentMessage[];
  maxIterations?: number;
  toolTimeout?: number;
}

// ── Agent Progress Events (background → sidepanel) ──

export interface AgentTextDeltaEvent {
  type: "AGENT_TEXT_DELTA";
  payload: { requestId: string; delta: string };
}

export interface AgentThinkingDeltaEvent {
  type: "AGENT_THINKING_DELTA";
  payload: { requestId: string; delta: string };
}

export interface AgentToolCallEvent {
  type: "AGENT_TOOL_CALL";
  payload: {
    requestId: string;
    toolCallId: string;
    name: string;
    arguments: string;
  };
}

export interface AgentToolResultEvent {
  type: "AGENT_TOOL_RESULT";
  payload: {
    requestId: string;
    toolCallId: string;
    name: string;
    result: string;
    isError: boolean;
  };
}

export interface AgentIterationStartEvent {
  type: "AGENT_ITERATION_START";
  payload: { requestId: string; iteration: number; maxIterations: number };
}

export interface AgentTurnCompleteEvent {
  type: "AGENT_TURN_COMPLETE";
  payload: { requestId: string; iterations: number };
}

export interface AgentErrorEvent {
  type: "AGENT_ERROR";
  payload: { requestId: string; error: string };
}

export type AgentProgressEvent =
  | AgentTextDeltaEvent
  | AgentThinkingDeltaEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentIterationStartEvent
  | AgentTurnCompleteEvent
  | AgentErrorEvent;

// ── Agent Session Persistence ──

export interface AgentSessionEntry {
  type: "user" | "assistant" | "thinking" | "tool";
  content: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
    result?: string;
    isError?: boolean;
    status: "running" | "success" | "error";
  };
}

export interface AgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AgentMessage[];
  entries: AgentSessionEntry[];
}

// ── Streaming Parser Types ──

export interface PendingToolCall {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

export interface AgentStreamResult {
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
}
