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
const SITE_ACTION_MEMORIES_KEY = "neonagent.siteActionMemories";

export interface SiteActionMemoryEntry {
  id: string;
  host: string;
  action: "click";
  query: string;
  role: string;
  selector: string;
  tagName?: string;
  label?: string;
  successCount: number;
  createdAt: number;
  updatedAt: number;
}

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

export class SiteActionMemoryRepository {
  constructor(private readonly storage: StorageLike) {}

  async getEntries(): Promise<SiteActionMemoryEntry[]> {
    const entries = await this.storage.get<SiteActionMemoryEntry[]>(SITE_ACTION_MEMORIES_KEY);
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries
      .filter((entry) =>
        typeof entry?.id === "string" &&
        typeof entry?.host === "string" &&
        typeof entry?.query === "string" &&
        typeof entry?.selector === "string"
      )
      .sort((a, b) => {
        if (b.successCount !== a.successCount) {
          return b.successCount - a.successCount;
        }
        return b.updatedAt - a.updatedAt;
      });
  }

  async findMatches(input: {
    host: string;
    query: string;
    role?: string;
    action?: "click";
    limit?: number;
  }): Promise<SiteActionMemoryEntry[]> {
    const host = input.host.trim().toLowerCase();
    const query = input.query.trim().toLowerCase();
    const role = (input.role || "any").trim().toLowerCase();
    const action = input.action ?? "click";
    const limit = Math.max(1, Math.min(10, input.limit ?? 5));
    const entries = await this.getEntries();
    const queryTokens = query.split(/\s+/).filter(Boolean);

    return entries
      .filter((entry) => {
        if (entry.action !== action) return false;
        if (entry.host.trim().toLowerCase() !== host) return false;
        if (role !== "any" && entry.role.trim().toLowerCase() !== role) return false;
        const entryQuery = entry.query.trim().toLowerCase();
        if (entryQuery === query) return true;
        return queryTokens.length > 0 && queryTokens.every((token) => entryQuery.includes(token));
      })
      .sort((a, b) => {
        const aExact = a.query.trim().toLowerCase() === query ? 1 : 0;
        const bExact = b.query.trim().toLowerCase() === query ? 1 : 0;
        if (bExact !== aExact) {
          return bExact - aExact;
        }
        if (b.successCount !== a.successCount) {
          return b.successCount - a.successCount;
        }
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, limit);
  }

  async recordSuccess(input: {
    host: string;
    query: string;
    role?: string;
    action?: "click";
    selector: string;
    tagName?: string;
    label?: string;
  }): Promise<SiteActionMemoryEntry> {
    const entries = await this.getEntries();
    const now = Date.now();
    const host = input.host.trim().toLowerCase();
    const query = input.query.trim().toLowerCase();
    const role = (input.role || "any").trim().toLowerCase();
    const action = input.action ?? "click";
    const selector = input.selector.trim();

    const existingIndex = entries.findIndex((entry) =>
      entry.host === host &&
      entry.query === query &&
      entry.role === role &&
      entry.action === action &&
      entry.selector === selector
    );

    const nextEntry: SiteActionMemoryEntry = existingIndex >= 0
      ? {
          ...entries[existingIndex],
          tagName: input.tagName?.trim() || entries[existingIndex].tagName,
          label: input.label?.trim() || entries[existingIndex].label,
          successCount: entries[existingIndex].successCount + 1,
          updatedAt: now
        }
      : {
          id: `site-action-${now}-${Math.random().toString(16).slice(2, 8)}`,
          host,
          action,
          query,
          role,
          selector,
          tagName: input.tagName?.trim() || "",
          label: input.label?.trim() || "",
          successCount: 1,
          createdAt: now,
          updatedAt: now
        };

    if (existingIndex >= 0) {
      entries[existingIndex] = nextEntry;
    } else {
      entries.unshift(nextEntry);
    }

    const trimmed = entries
      .sort((a, b) => {
        if (b.successCount !== a.successCount) {
          return b.successCount - a.successCount;
        }
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, 300);

    await this.storage.set(SITE_ACTION_MEMORIES_KEY, trimmed);
    return nextEntry;
  }
}
