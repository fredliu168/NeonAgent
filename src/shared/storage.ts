import { DEFAULT_CONFIG } from "./config.js";
import type { ChatSession, LLMConfig } from "./types.js";
import type { AgentSession } from "./agentTypes.js";

export interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
}

const CONFIG_KEY = "neonagent.config";
const CHAT_SESSIONS_KEY = "neonagent.chatSessions";

export class ConfigRepository {
  constructor(private readonly storage: StorageLike) {}

  async getConfig(): Promise<LLMConfig> {
    const cfg = await this.storage.get<LLMConfig>(CONFIG_KEY);
    return cfg ?? DEFAULT_CONFIG;
  }

  async saveConfig(config: LLMConfig): Promise<void> {
    await this.storage.set(CONFIG_KEY, config);
  }
}

export class ChatHistoryRepository {
  constructor(private readonly storage: StorageLike) {}

  async getSessions(): Promise<ChatSession[]> {
    const sessions = await this.storage.get<ChatSession[]>(CHAT_SESSIONS_KEY);
    if (!Array.isArray(sessions)) {
      return [];
    }

    return sessions
      .filter((session) => typeof session?.id === "string" && Array.isArray(session.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveSession(nextSession: ChatSession): Promise<void> {
    const sessions = await this.getSessions();
    const idx = sessions.findIndex((session) => session.id === nextSession.id);

    if (idx >= 0) {
      sessions[idx] = nextSession;
    } else {
      sessions.unshift(nextSession);
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    await this.storage.set(CHAT_SESSIONS_KEY, sessions);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessions = await this.getSessions();
    const next = sessions.filter((session) => session.id !== sessionId);
    await this.storage.set(CHAT_SESSIONS_KEY, next);
  }

  async clearAllSessions(): Promise<void> {
    await this.storage.set(CHAT_SESSIONS_KEY, [] as ChatSession[]);
  }
}

const AGENT_SESSIONS_KEY = "neonagent.agentSessions";

export class AgentHistoryRepository {
  constructor(private readonly storage: StorageLike) {}

  async getSessions(): Promise<AgentSession[]> {
    const sessions = await this.storage.get<AgentSession[]>(AGENT_SESSIONS_KEY);
    if (!Array.isArray(sessions)) {
      return [];
    }

    return sessions
      .filter((session) => typeof session?.id === "string" && Array.isArray(session.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveSession(nextSession: AgentSession): Promise<void> {
    const sessions = await this.getSessions();
    const idx = sessions.findIndex((session) => session.id === nextSession.id);

    if (idx >= 0) {
      sessions[idx] = nextSession;
    } else {
      sessions.unshift(nextSession);
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    await this.storage.set(AGENT_SESSIONS_KEY, sessions);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessions = await this.getSessions();
    const next = sessions.filter((session) => session.id !== sessionId);
    await this.storage.set(AGENT_SESSIONS_KEY, next);
  }

  async clearAllSessions(): Promise<void> {
    await this.storage.set(AGENT_SESSIONS_KEY, [] as AgentSession[]);
  }
}