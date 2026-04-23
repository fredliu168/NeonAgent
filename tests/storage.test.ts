import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/shared/config";
import { ChatHistoryRepository, ConfigRepository, type StorageLike } from "../src/shared/storage";

class InMemoryStorage implements StorageLike {
  private store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
}

describe("ConfigRepository", () => {
  it("returns default config when empty", async () => {
    const repo = new ConfigRepository(new InMemoryStorage());
    const config = await repo.getConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("saves and reads config", async () => {
    const repo = new ConfigRepository(new InMemoryStorage());
    const next = {
      ...DEFAULT_CONFIG,
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "abc"
    };

    await repo.saveConfig(next);
    const loaded = await repo.getConfig();
    expect(loaded).toEqual(next);
  });

  it("migrates old config without models field", async () => {
    const storage = new InMemoryStorage();
    const oldConfig = {
      baseUrl: "https://api.example.com",
      apiKey: "key",
      model: "gpt-4",
      temperature: 0.2,
      maxTokens: 1024,
      agentMaxTokens: 102400,
      systemPrompt: "test",
      unlockContextMenu: false,
      blockVisibilityDetection: false,
      aggressiveVisibilityBypass: false,
      enableFloatingBall: false
    };
    await storage.set("neonagent.config", oldConfig);
    const repo = new ConfigRepository(storage);
    const loaded = await repo.getConfig();
    expect(loaded.models).toEqual(["gpt-4"]);
    expect(loaded.model).toBe("gpt-4");
  });
});

describe("ChatHistoryRepository", () => {
  it("saves and reads sessions sorted by updatedAt desc", async () => {
    const repo = new ChatHistoryRepository(new InMemoryStorage());

    await repo.saveSession({
      id: "s1",
      title: "old",
      createdAt: 1,
      updatedAt: 10,
      messages: [{ role: "user", content: "hello" }]
    });
    await repo.saveSession({
      id: "s2",
      title: "new",
      createdAt: 2,
      updatedAt: 20,
      messages: [{ role: "assistant", content: "world" }]
    });

    const sessions = await repo.getSessions();
    expect(sessions.map((item) => item.id)).toEqual(["s2", "s1"]);
  });

  it("deletes and clears sessions", async () => {
    const repo = new ChatHistoryRepository(new InMemoryStorage());

    await repo.saveSession({
      id: "s1",
      title: "chat",
      createdAt: 1,
      updatedAt: 1,
      messages: []
    });
    await repo.saveSession({
      id: "s2",
      title: "chat2",
      createdAt: 2,
      updatedAt: 2,
      messages: []
    });

    await repo.deleteSession("s1");
    expect((await repo.getSessions()).map((item) => item.id)).toEqual(["s2"]);

    await repo.clearAllSessions();
    expect(await repo.getSessions()).toEqual([]);
  });
});