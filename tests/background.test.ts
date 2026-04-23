import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/shared/config";
import { createBackgroundMessageHandler } from "../src/background";
import {
  createLLMRequestMessage,
  createLLMStreamCancelMessage,
  createLLMStreamRequestMessage
} from "../src/shared/messages";
import type { StorageLike } from "../src/shared/storage";

class InMemoryStorage implements StorageLike {
  private store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushMany(times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await flushMicrotasks();
  }
}

describe("background message handler", () => {
  it("returns PONG for PING", async () => {
    const handler = createBackgroundMessageHandler(new InMemoryStorage());
    const sendResponse = vi.fn();

    const keepAlive = handler({ type: "PING" }, {}, sendResponse);
    await Promise.resolve();

    expect(keepAlive).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: "PONG" });
  });

  it("rejects invalid SAVE_CONFIG payload", async () => {
    const handler = createBackgroundMessageHandler(new InMemoryStorage());
    const sendResponse = vi.fn();

    handler(
      {
        type: "SAVE_CONFIG",
        payload: {
          ...DEFAULT_CONFIG,
          baseUrl: "",
          apiKey: "",
          model: ""
        }
      },
      {},
      sendResponse
    );
    await Promise.resolve();

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      errors: expect.arrayContaining([
        "baseUrl is required",
        "apiKey is required",
        "model is required"
      ])
    });
  });

  it("stores valid config and can read it back", async () => {
    const handler = createBackgroundMessageHandler(new InMemoryStorage());
    const saveResponse = vi.fn();
    const validConfig = {
      ...DEFAULT_CONFIG,
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "abc"
    };

    handler({ type: "SAVE_CONFIG", payload: validConfig }, {}, saveResponse);
    await flushMicrotasks();
    expect(saveResponse).toHaveBeenCalledWith({ ok: true });

    const getResponse = vi.fn();
    handler({ type: "GET_CONFIG" }, {}, getResponse);
    await flushMicrotasks();
    expect(getResponse).toHaveBeenCalledWith({ ok: true, data: validConfig });
  });

  it("saves and lists chat sessions", async () => {
    const handler = createBackgroundMessageHandler(new InMemoryStorage());
    const saveResponse = vi.fn();

    handler(
      {
        type: "SAVE_CHAT_SESSION",
        payload: {
          id: "chat-1",
          title: "hello",
          createdAt: 1,
          updatedAt: 2,
          messages: [{ role: "user", content: "Hi" }]
        }
      },
      {},
      saveResponse
    );
    await flushMany(4);
    expect(saveResponse).toHaveBeenCalledWith({ ok: true });

    const getResponse = vi.fn();
    handler({ type: "GET_CHAT_SESSIONS" }, {}, getResponse);
    await flushMany(4);

    expect(getResponse).toHaveBeenCalledWith({
      ok: true,
      data: [
        {
          id: "chat-1",
          title: "hello",
          createdAt: 1,
          updatedAt: 2,
          messages: [{ role: "user", content: "Hi" }]
        }
      ]
    });
  });

  it("handles LLM_REQUEST and returns assistant content", async () => {
    const invokeLLM = vi.fn(async () => "model answer");
    const handler = createBackgroundMessageHandler(new InMemoryStorage(), { invokeLLM });
    const sendResponse = vi.fn();

    handler(
      createLLMRequestMessage({
        config: {
          ...DEFAULT_CONFIG,
          baseUrl: "http://123.207.223.64:7600/v1/chat/completions",
          apiKey: "test-key",
          model: "Qwen/Qwen3-8B",
          temperature: 0.8
        },
        messages: [{ role: "user", content: "hello" }],
        pageContext: "sample page"
      }),
      {},
      sendResponse
    );

    await flushMicrotasks();

    expect(invokeLLM).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      data: { content: "model answer" }
    });
  });

  it("handles LLM_STREAM_REQUEST and emits stream events", async () => {
    async function* invokeLLMStream(): AsyncGenerator<{ content: string | null; reasoning: string | null }> {
      yield { content: "hel", reasoning: null };
      yield { content: "lo", reasoning: null };
    }

    const emitStreamEvent = vi.fn();
    const handler = createBackgroundMessageHandler(new InMemoryStorage(), {
      invokeLLMStream,
      emitStreamEvent
    });
    const sendResponse = vi.fn();

    handler(
      createLLMStreamRequestMessage({
        requestId: "req-1",
        config: {
          ...DEFAULT_CONFIG,
          baseUrl: "http://123.207.223.64:7600/v1/chat/completions",
          apiKey: "test-key",
          model: "Qwen/Qwen3-8B"
        },
        messages: [{ role: "user", content: "hello" }],
        pageContext: "sample page"
      }),
      {},
      sendResponse
    );

    await flushMany(6);

    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { requestId: "req-1" } });
    expect(emitStreamEvent).toHaveBeenNthCalledWith(1, {
      type: "LLM_STREAM_CHUNK",
      payload: { requestId: "req-1", delta: "hel", reasoning: undefined }
    });
    expect(emitStreamEvent).toHaveBeenNthCalledWith(2, {
      type: "LLM_STREAM_CHUNK",
      payload: { requestId: "req-1", delta: "lo", reasoning: undefined }
    });
    expect(emitStreamEvent).toHaveBeenNthCalledWith(3, {
      type: "LLM_STREAM_DONE",
      payload: { requestId: "req-1" }
    });
  });

  it("handles LLM_STREAM_CANCEL and aborts active stream", async () => {
    async function* invokeLLMStream(input: { signal?: AbortSignal }): AsyncGenerator<{ content: string | null; reasoning: string | null }> {
      while (!input.signal?.aborted) {
        await Promise.resolve();
      }
    }

    const emitStreamEvent = vi.fn();
    const handler = createBackgroundMessageHandler(new InMemoryStorage(), {
      invokeLLMStream,
      emitStreamEvent
    });

    const startResponse = vi.fn();
    handler(
      createLLMStreamRequestMessage({
        requestId: "req-cancel",
        config: {
          ...DEFAULT_CONFIG,
          baseUrl: "http://123.207.223.64:7600/v1/chat/completions",
          apiKey: "test-key",
          model: "Qwen/Qwen3-8B"
        },
        messages: [{ role: "user", content: "hello" }]
      }),
      {},
      startResponse
    );

    const cancelResponse = vi.fn();
    handler(
      createLLMStreamCancelMessage({ requestId: "req-cancel" }),
      {},
      cancelResponse
    );

    await flushMany(8);

    expect(startResponse).toHaveBeenCalledWith({ ok: true, data: { requestId: "req-cancel" } });
    expect(cancelResponse).toHaveBeenCalledWith({
      ok: true,
      data: { requestId: "req-cancel", canceled: true }
    });
    expect(emitStreamEvent).toHaveBeenCalledWith({
      type: "LLM_STREAM_DONE",
      payload: { requestId: "req-cancel" }
    });
  });

  // ── Skill direct management handlers ──

  it("GET_SKILL returns full skill data", async () => {
    const storage = new InMemoryStorage();
    const handler = createBackgroundMessageHandler(storage);

    // First create a skill via LIST_SKILLS won't work, need to create via createSkill
    const { createSkill } = await import("../src/shared/agentSkills");
    const skill = await createSkill(storage, "TestSkill", "desc", ["step1", "step2"], ["tag1"]);

    const sendResponse = vi.fn();
    handler({ type: "GET_SKILL", payload: { skillId: skill.id } }, {}, sendResponse);
    await flushMany(4);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true })
    );
    expect(sendResponse.mock.calls[0][0].data.name).toBe("TestSkill");
    expect(sendResponse.mock.calls[0][0].data.steps).toHaveLength(2);
  });

  it("UPDATE_SKILL_DIRECT updates a skill", async () => {
    const storage = new InMemoryStorage();
    const handler = createBackgroundMessageHandler(storage);

    const { createSkill } = await import("../src/shared/agentSkills");
    const skill = await createSkill(storage, "OldName", "old desc", ["old step"]);

    const sendResponse = vi.fn();
    handler({ type: "UPDATE_SKILL_DIRECT", payload: { skillId: skill.id, name: "NewName", steps: ["new step 1", "new step 2"] } }, {}, sendResponse);
    await flushMany(4);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true })
    );
    expect(sendResponse.mock.calls[0][0].data.name).toBe("NewName");
    expect(sendResponse.mock.calls[0][0].data.version).toBe(2);
  });

  it("DELETE_SKILL_DIRECT deletes a skill", async () => {
    const storage = new InMemoryStorage();
    const handler = createBackgroundMessageHandler(storage);

    const { createSkill } = await import("../src/shared/agentSkills");
    const skill = await createSkill(storage, "ToDelete", "desc", ["step"]);

    const sendResponse = vi.fn();
    handler({ type: "DELETE_SKILL_DIRECT", payload: { skillId: skill.id } }, {}, sendResponse);
    await flushMany(4);

    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { deleted: true } });
  });

  it("IMPORT_SKILLS imports skills and skips duplicates", async () => {
    const storage = new InMemoryStorage();
    const handler = createBackgroundMessageHandler(storage);

    const { createSkill } = await import("../src/shared/agentSkills");
    await createSkill(storage, "Existing", "desc", ["step"]);

    const sendResponse = vi.fn();
    handler({
      type: "IMPORT_SKILLS",
      payload: {
        skills: [
          { name: "Existing", description: "dup", steps: ["s1"] },
          { name: "NewSkill", description: "new", steps: ["s2", "s3"] }
        ]
      }
    }, {}, sendResponse);
    await flushMany(4);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true })
    );
    const data = sendResponse.mock.calls[0][0].data;
    expect(data.imported).toHaveLength(1);
    expect(data.skipped).toEqual(["Existing"]);
  });
});