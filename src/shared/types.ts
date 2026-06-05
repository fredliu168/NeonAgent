export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  temperature: number;
  maxTokens: number;
  agentMaxTokens: number;
  systemPrompt: string;
  translationEnabled: boolean;
  selectionTranslationEnabled: boolean;
  translationTargetLanguage: string;
  translationDisplayMode: "replace" | "bilingual";
  translationStyleColor: string;
  translationStyleBackground: string;
  translationStyleFontSize: number;
  translationStyleBold: boolean;
  translationStyleItalic: boolean;
  translationDebounceMs: number;
  translationBatchSize: number;
  unlockContextMenu: boolean;
  blockVisibilityDetection: boolean;
  aggressiveVisibilityBypass: boolean;
  blockFullscreenRequests: boolean;
  autoSolveCurrentPage: boolean;
  enableFloatingBall: boolean;
  /** Built-in local command WebSocket client for Codex/OpenClaw control. */
  localCommandEnabled: boolean;
  localCommandWsUrl: string;
  localCommandToken: string;
  /** How to pass thinking/reasoning back to the API on subsequent turns.
   * "none"   – strip reasoning_content (standard OpenAI-compatible APIs)
   * "field"  – keep as top-level reasoning_content field (native DeepSeek API)
   * "blocks" – convert to content[].thinking blocks (Anthropic-compatible APIs)
   */
  thinkingFormat: "none" | "field" | "blocks";
}

export interface FeatureFlags {
  unlockContextMenu: boolean;
  blockVisibilityDetection: boolean;
  aggressiveVisibilityBypass: boolean;
  blockFullscreenRequests: boolean;
  enableFloatingBall: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning_content?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ExamOption {
  label: string;
  text: string;
}

export interface ExamQuestion {
  id: string;
  stem: string;
  options: ExamOption[];
  questionType?: "single" | "multiple" | "judgement";
}

export interface ExamAnswerMatch {
  questionId: string;
  answerLabel: string;
  answerLabels?: string[];
}

export interface LLMRequestPayload {
  type: "LLM_REQUEST";
  payload: {
    config: LLMConfig;
    messages: ChatMessage[];
    pageContext?: string;
  };
}

export interface LLMStreamRequestPayload {
  type: "LLM_STREAM_REQUEST";
  payload: {
    requestId: string;
    config: LLMConfig;
    messages: ChatMessage[];
    pageContext?: string;
  };
}

export interface LLMStreamCancelPayload {
  type: "LLM_STREAM_CANCEL";
  payload: {
    requestId: string;
  };
}

export interface LLMStreamChunkEvent {
  type: "LLM_STREAM_CHUNK";
  payload: {
    requestId: string;
    delta: string;
    reasoning?: string;
  };
}

export interface LLMStreamDoneEvent {
  type: "LLM_STREAM_DONE";
  payload: {
    requestId: string;
  };
}

export interface LLMStreamErrorEvent {
  type: "LLM_STREAM_ERROR";
  payload: {
    requestId: string;
    error: string;
  };
}

export interface PingPayload {
  type: "PING";
}

export type RuntimeMessage =
  | LLMRequestPayload
  | LLMStreamRequestPayload
  | LLMStreamCancelPayload
  | PingPayload;

export type RuntimeStreamEvent =
  | LLMStreamChunkEvent
  | LLMStreamDoneEvent
  | LLMStreamErrorEvent;
