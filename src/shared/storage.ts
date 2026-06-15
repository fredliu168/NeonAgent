import { DEFAULT_CONFIG, migrateConfig } from "./config.js";
import type { ChatSession, LLMConfig, XBlockedAccountRecord } from "./types.js";
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
    return cfg ? migrateConfig(cfg) : DEFAULT_CONFIG;
  }

  async saveConfig(config: LLMConfig): Promise<void> {
    await this.storage.set(CONFIG_KEY, migrateConfig(config));
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
const X_BLOCKED_ACCOUNTS_KEY = "neonagent.xBlockedAccounts";

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

export class XBlockedAccountRepository {
  constructor(private readonly storage: StorageLike) {}

  async getRecords(): Promise<XBlockedAccountRecord[]> {
    const records = await this.storage.get<XBlockedAccountRecord[]>(X_BLOCKED_ACCOUNTS_KEY);
    if (!Array.isArray(records)) {
      return [];
    }

    return records
      .filter((record) => typeof record?.id === "string" && typeof record?.handle === "string")
      .sort((a, b) => b.blockedAt - a.blockedAt);
  }

  async saveRecord(nextRecord: XBlockedAccountRecord): Promise<void> {
    const records = await this.getRecords();
    const idx = records.findIndex((record) => record.id === nextRecord.id || record.handle.toLowerCase() === nextRecord.handle.toLowerCase());

    if (idx >= 0) {
      records[idx] = nextRecord;
    } else {
      records.unshift(nextRecord);
    }

    records.sort((a, b) => b.blockedAt - a.blockedAt);
    await this.storage.set(X_BLOCKED_ACCOUNTS_KEY, records);
  }

  async markRestored(handle: string): Promise<XBlockedAccountRecord | null> {
    const records = await this.getRecords();
    const idx = records.findIndex((record) => record.handle.toLowerCase() === handle.trim().toLowerCase());
    if (idx < 0) {
      return null;
    }

    const updated: XBlockedAccountRecord = {
      ...records[idx],
      restoredAt: Date.now()
    };
    records[idx] = updated;
    await this.storage.set(X_BLOCKED_ACCOUNTS_KEY, records);
    return updated;
  }
}
