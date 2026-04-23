import { describe, it, expect, beforeEach } from "vitest";
import {
  addMemory,
  searchMemories,
  deleteMemory,
  getAllMemories,
  formatMemoriesForPrompt,
  needsCompression,
  groupMemoriesByTag,
  buildCompressionPrompt,
  parseCompressionResult,
  compressMemories,
  memoryToMarkdown,
  memoriesToMarkdown,
  parseMemoriesMarkdown,
  importMemories,
  COMPRESS_THRESHOLD
} from "../src/shared/agentMemory.js";
import type { MemoryEntry } from "../src/shared/agentMemory.js";
import type { StorageLike } from "../src/shared/storage.js";

function createMemoryStore(): StorageLike {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      data.set(key, value);
    }
  };
}

describe("agentMemory", () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = createMemoryStore();
  });

  it("addMemory creates a new entry", async () => {
    const entry = await addMemory(storage, "用户喜欢简洁回复", ["偏好"]);
    expect(entry.id).toMatch(/^mem-/);
    expect(entry.content).toBe("用户喜欢简洁回复");
    expect(entry.tags).toEqual(["偏好"]);

    const all = await getAllMemories(storage);
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(entry.id);
  });

  it("searchMemories finds by keyword", async () => {
    await addMemory(storage, "网站A的登录按钮class是.login-btn", ["网站特征"]);
    await addMemory(storage, "用户偏好中文回复", ["偏好"]);
    await addMemory(storage, "执行JS时要用try/catch包裹", ["经验"]);

    const results = await searchMemories(storage, "登录");
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("登录按钮");
  });

  it("searchMemories with empty query returns all", async () => {
    await addMemory(storage, "fact1");
    await addMemory(storage, "fact2");

    const results = await searchMemories(storage, "");
    expect(results).toHaveLength(2);
  });

  it("searchMemories finds by tag", async () => {
    await addMemory(storage, "something", ["偏好"]);
    await addMemory(storage, "other thing", ["经验"]);

    const results = await searchMemories(storage, "偏好");
    expect(results).toHaveLength(1);
  });

  it("deleteMemory removes the entry", async () => {
    const entry = await addMemory(storage, "to be deleted");
    expect(await getAllMemories(storage)).toHaveLength(1);

    const deleted = await deleteMemory(storage, entry.id);
    expect(deleted).toBe(true);
    expect(await getAllMemories(storage)).toHaveLength(0);
  });

  it("deleteMemory returns false for unknown id", async () => {
    const deleted = await deleteMemory(storage, "nonexistent");
    expect(deleted).toBe(false);
  });

  it("formatMemoriesForPrompt returns empty for no entries", () => {
    expect(formatMemoriesForPrompt([])).toBe("");
  });

  it("formatMemoriesForPrompt formats entries", async () => {
    await addMemory(storage, "用户喜欢中文", ["偏好"]);
    const all = await getAllMemories(storage);
    const result = formatMemoriesForPrompt(all);
    expect(result).toContain("记忆");
    expect(result).toContain("用户喜欢中文");
    expect(result).toContain("[偏好]");
  });

  // ── Compression ──

  it("needsCompression returns false when under threshold", () => {
    const entries: MemoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: `mem-${i}`, content: `fact ${i}`, tags: [], createdAt: i, updatedAt: i
    }));
    expect(needsCompression(entries)).toBe(false);
  });

  it("needsCompression returns true when over threshold", () => {
    const entries: MemoryEntry[] = Array.from({ length: COMPRESS_THRESHOLD + 1 }, (_, i) => ({
      id: `mem-${i}`, content: `fact ${i}`, tags: [], createdAt: i, updatedAt: i
    }));
    expect(needsCompression(entries)).toBe(true);
  });

  it("groupMemoriesByTag groups by tag key", () => {
    const entries: MemoryEntry[] = [
      { id: "1", content: "a", tags: ["偏好"], createdAt: 1, updatedAt: 1 },
      { id: "2", content: "b", tags: ["偏好"], createdAt: 2, updatedAt: 2 },
      { id: "3", content: "c", tags: [], createdAt: 3, updatedAt: 3 }
    ];
    const groups = groupMemoriesByTag(entries);
    expect(groups.get("偏好")).toHaveLength(2);
    expect(groups.get("__untagged__")).toHaveLength(1);
  });

  it("buildCompressionPrompt includes all memories", () => {
    const prompt = buildCompressionPrompt(["fact A", "fact B", "fact C"]);
    expect(prompt).toContain("fact A");
    expect(prompt).toContain("fact B");
    expect(prompt).toContain("3 条");
  });

  it("parseCompressionResult extracts lines starting with -", () => {
    const text = "以下是压缩结果：\n- 合并后的记忆1\n- 合并后的记忆2\n其他文字";
    const result = parseCompressionResult(text);
    expect(result).toEqual(["合并后的记忆1", "合并后的记忆2"]);
  });

  it("parseCompressionResult handles empty input", () => {
    expect(parseCompressionResult("")).toEqual([]);
    expect(parseCompressionResult("no items")).toEqual([]);
  });

  it("compressMemories skips when under threshold", async () => {
    await addMemory(storage, "short list");
    const callLLM = async () => "should not be called";
    const result = await compressMemories(storage, callLLM);
    expect(result.originalCount).toBe(1);
    expect(result.compressedCount).toBe(1);
  });

  it("compressMemories calls LLM and replaces entries", async () => {
    // Fill beyond threshold
    for (let i = 0; i < COMPRESS_THRESHOLD + 5; i++) {
      await addMemory(storage, `memory item ${i}`, ["test"]);
    }
    const before = await getAllMemories(storage);
    expect(before).toHaveLength(COMPRESS_THRESHOLD + 5);

    const callLLM = async (_prompt: string) => {
      return "- 压缩合并后的记忆A\n- 压缩合并后的记忆B";
    };
    const result = await compressMemories(storage, callLLM);
    expect(result.originalCount).toBe(COMPRESS_THRESHOLD + 5);
    expect(result.compressedCount).toBeLessThan(result.originalCount);

    const after = await getAllMemories(storage);
    expect(after.length).toBeLessThan(before.length);
  });

  it("compressMemories keeps recent entries untouched", async () => {
    for (let i = 0; i < COMPRESS_THRESHOLD + 5; i++) {
      await addMemory(storage, `item ${i}`);
    }
    const callLLM = async () => "- compressed";
    await compressMemories(storage, callLLM);
    const after = await getAllMemories(storage);
    // Last 10 are kept, check some exist
    expect(after.some((m) => m.content.includes("item"))).toBe(true);
  });

  it("compressMemories keeps originals on LLM error", async () => {
    for (let i = 0; i < COMPRESS_THRESHOLD + 5; i++) {
      await addMemory(storage, `item ${i}`, ["grp"]);
    }
    const callLLM = async () => { throw new Error("LLM down"); };
    const result = await compressMemories(storage, callLLM);
    // Should keep all originals
    expect(result.compressedCount).toBe(COMPRESS_THRESHOLD + 5);
  });

  // ── Markdown import/export ──

  it("memoryToMarkdown serializes entry", () => {
    const entry: MemoryEntry = {
      id: "mem-1", content: "用户喜欢中文", tags: ["偏好", "语言"],
      createdAt: 0, updatedAt: 0
    };
    const md = memoryToMarkdown(entry);
    expect(md).toContain("- 用户喜欢中文");
    expect(md).toContain("> Tags: 偏好, 语言");
  });

  it("memoryToMarkdown omits tag line when empty", () => {
    const entry: MemoryEntry = {
      id: "mem-1", content: "no tags", tags: [],
      createdAt: 0, updatedAt: 0
    };
    const md = memoryToMarkdown(entry);
    expect(md).toBe("- no tags");
    expect(md).not.toContain("Tags");
  });

  it("memoriesToMarkdown includes header and all entries", async () => {
    await addMemory(storage, "fact 1", ["a"]);
    await addMemory(storage, "fact 2");
    const all = await getAllMemories(storage);
    const md = memoriesToMarkdown(all);
    expect(md).toContain("# NeonAgent 记忆导出");
    expect(md).toContain("条目数量: 2");
    expect(md).toContain("- fact 1");
    expect(md).toContain("- fact 2");
    expect(md).toContain("> Tags: a");
  });

  it("parseMemoriesMarkdown parses valid markdown", () => {
    const md = `# NeonAgent 记忆导出

导出时间: 2026-01-01
条目数量: 2

---

- 用户喜欢简洁回复
  > Tags: 偏好, 语言
- 网站A登录按钮class是.login`;
    const parsed = parseMemoriesMarkdown(md);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].content).toBe("用户喜欢简洁回复");
    expect(parsed[0].tags).toEqual(["偏好", "语言"]);
    expect(parsed[1].content).toBe("网站A登录按钮class是.login");
    expect(parsed[1].tags).toEqual([]);
  });

  it("parseMemoriesMarkdown ignores non-list lines", () => {
    const md = "some header\nrandom line\n- actual memory\n## section";
    const parsed = parseMemoriesMarkdown(md);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].content).toBe("actual memory");
  });

  it("parseMemoriesMarkdown returns empty for no items", () => {
    expect(parseMemoriesMarkdown("")).toEqual([]);
    expect(parseMemoriesMarkdown("no list items here")).toEqual([]);
  });

  it("roundtrip: memoriesToMarkdown -> parseMemoriesMarkdown", async () => {
    await addMemory(storage, "fact A", ["tag1"]);
    await addMemory(storage, "fact B", ["tag2", "tag3"]);
    await addMemory(storage, "fact C");
    const all = await getAllMemories(storage);
    const md = memoriesToMarkdown(all);
    const parsed = parseMemoriesMarkdown(md);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].content).toBe("fact A");
    expect(parsed[0].tags).toEqual(["tag1"]);
    expect(parsed[1].content).toBe("fact B");
    expect(parsed[1].tags).toEqual(["tag2", "tag3"]);
    expect(parsed[2].content).toBe("fact C");
    expect(parsed[2].tags).toEqual([]);
  });

  // ── Import ──

  it("importMemories adds new entries", async () => {
    const result = await importMemories(storage, [
      { content: "new fact 1", tags: ["a"] },
      { content: "new fact 2" }
    ]);
    expect(result.imported).toHaveLength(2);
    expect(result.skipped).toBe(0);
    const all = await getAllMemories(storage);
    expect(all).toHaveLength(2);
  });

  it("importMemories skips duplicate content", async () => {
    await addMemory(storage, "existing fact");
    const result = await importMemories(storage, [
      { content: "existing fact" },
      { content: "new fact" }
    ]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].content).toBe("new fact");
    expect(result.skipped).toBe(1);
  });

  it("importMemories skips empty content", async () => {
    const result = await importMemories(storage, [
      { content: "" },
      { content: "   " },
      { content: "valid" }
    ]);
    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toBe(2);
  });
});
