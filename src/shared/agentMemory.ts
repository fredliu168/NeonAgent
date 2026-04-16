/**
 * Agent memory persistence — stores key facts, user preferences,
 * and learned context across agent sessions via StorageLike.
 * Supports automatic compression and Markdown import/export.
 */

import type { StorageLike } from "./storage.js";

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "neonagent.agent_memories";

/** Compression triggers when entry count exceeds this value. */
export const COMPRESS_THRESHOLD = 50;

/** Target entry count after compression. */
export const COMPRESS_TARGET = 30;

async function loadAll(storage: StorageLike): Promise<MemoryEntry[]> {
  const raw = await storage.get<MemoryEntry[]>(STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw;
}

async function saveAll(storage: StorageLike, entries: MemoryEntry[]): Promise<void> {
  await storage.set(STORAGE_KEY, entries);
}

export async function addMemory(
  storage: StorageLike,
  content: string,
  tags: string[] = []
): Promise<MemoryEntry> {
  const entries = await loadAll(storage);
  const now = Date.now();
  const entry: MemoryEntry = {
    id: `mem-${now}-${Math.random().toString(16).slice(2, 8)}`,
    content: content.trim(),
    tags: tags.map((t) => t.trim().toLowerCase()),
    createdAt: now,
    updatedAt: now
  };
  entries.push(entry);
  await saveAll(storage, entries);
  return entry;
}

export async function searchMemories(
  storage: StorageLike,
  query: string
): Promise<MemoryEntry[]> {
  const entries = await loadAll(storage);
  if (!query.trim()) return entries;

  const q = query.toLowerCase();
  const keywords = q.split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const text = `${entry.content} ${entry.tags.join(" ")}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw));
  });
}

export async function deleteMemory(
  storage: StorageLike,
  memoryId: string
): Promise<boolean> {
  const entries = await loadAll(storage);
  const filtered = entries.filter((e) => e.id !== memoryId);
  if (filtered.length === entries.length) return false;
  await saveAll(storage, filtered);
  return true;
}

export async function getAllMemories(
  storage: StorageLike
): Promise<MemoryEntry[]> {
  return loadAll(storage);
}

/**
 * Format memories for inclusion in the system prompt.
 */
export function formatMemoriesForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => {
    const tagStr = e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : "";
    return `- ${e.content}${tagStr}`;
  });
  return `# 记忆（已保存的知识与偏好）\n以下是你之前保存的记忆条目，请在回答时参考这些信息：\n${lines.join("\n")}`;
}

// ── Memory compression ──

/**
 * Check if memories need compression (exceed threshold).
 */
export function needsCompression(entries: MemoryEntry[]): boolean {
  return entries.length > COMPRESS_THRESHOLD;
}

/**
 * Group memories by their tags for batch compression.
 * Entries with no tags go into the "__untagged__" group.
 */
export function groupMemoriesByTag(entries: MemoryEntry[]): Map<string, MemoryEntry[]> {
  const groups = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const key = entry.tags.length > 0 ? entry.tags.sort().join(",") : "__untagged__";
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return groups;
}

/**
 * Build the compression prompt for the LLM.
 * Takes a batch of memory content strings and asks for a compressed summary.
 */
export function buildCompressionPrompt(memories: string[]): string {
  const joined = memories.map((m, i) => `${i + 1}. ${m}`).join("\n");
  return `你是一个记忆压缩助手。以下是 ${memories.length} 条保存的记忆条目：

${joined}

请将以上记忆压缩合并为更少的条目（尽量不超过 ${Math.ceil(memories.length / 3)} 条），规则：
1. 合并语义相似或相关的条目为一条
2. 保留所有重要信息，不丢失关键细节
3. 使用简洁准确的中文表述
4. 每条独占一行，以 "- " 开头
5. 只输出压缩后的条目列表，不要输出任何其他解释

输出格式：
- 压缩后的记忆条目1
- 压缩后的记忆条目2`;
}

/**
 * Parse compression result from LLM output — extracts lines starting with "- ".
 */
export function parseCompressionResult(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

/**
 * Compress memories using an LLM call. Replaces old entries with compressed ones.
 * @param storage - storage adapter
 * @param callLLM - function that takes a prompt string and returns the LLM response text
 * @returns compression stats: original count, compressed count, saved count
 */
export async function compressMemories(
  storage: StorageLike,
  callLLM: (prompt: string) => Promise<string>
): Promise<{ originalCount: number; compressedCount: number }> {
  const entries = await loadAll(storage);
  if (!needsCompression(entries)) {
    return { originalCount: entries.length, compressedCount: entries.length };
  }

  // Sort by creation time, keep newest entries untouched (last 10)
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const keepRecent = 10;
  const toCompress = sorted.slice(0, sorted.length - keepRecent);
  const recentKeep = sorted.slice(sorted.length - keepRecent);

  // Group by tags and compress each group
  const groups = groupMemoriesByTag(toCompress);
  const compressed: MemoryEntry[] = [];
  const now = Date.now();

  for (const [tagKey, groupEntries] of groups) {
    if (groupEntries.length <= 2) {
      // Too few to compress, keep as-is
      compressed.push(...groupEntries);
      continue;
    }

    const prompt = buildCompressionPrompt(groupEntries.map((e) => e.content));
    try {
      const result = await callLLM(prompt);
      const lines = parseCompressionResult(result);
      if (lines.length === 0) {
        // Compression failed, keep originals
        compressed.push(...groupEntries);
        continue;
      }

      const tags = tagKey === "__untagged__" ? [] : tagKey.split(",");
      for (const content of lines) {
        compressed.push({
          id: `mem-${now}-${Math.random().toString(16).slice(2, 8)}`,
          content,
          tags,
          createdAt: now,
          updatedAt: now
        });
      }
    } catch {
      // On LLM error, keep originals
      compressed.push(...groupEntries);
    }
  }

  const finalEntries = [...compressed, ...recentKeep];
  await saveAll(storage, finalEntries);
  return { originalCount: entries.length, compressedCount: finalEntries.length };
}

// ── Markdown import / export ──

/**
 * Serialize a single memory entry to Markdown.
 */
export function memoryToMarkdown(entry: MemoryEntry): string {
  const lines: string[] = [];
  lines.push(`- ${entry.content}`);
  if (entry.tags.length > 0) {
    lines.push(`  > Tags: ${entry.tags.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Serialize all memory entries into a Markdown document.
 */
export function memoriesToMarkdown(entries: MemoryEntry[]): string {
  const lines: string[] = [];
  lines.push("# NeonAgent 记忆导出");
  lines.push("");
  lines.push(`导出时间: ${new Date().toISOString()}`);
  lines.push(`条目数量: ${entries.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const entry of entries) {
    lines.push(memoryToMarkdown(entry));
  }
  return lines.join("\n");
}

/**
 * Parse a Markdown document into memory import data.
 * Accepts lines starting with "- " as memory content.
 * Lines starting with "  > Tags: " provide tags for the preceding entry.
 */
export function parseMemoriesMarkdown(md: string): Array<{ content: string; tags: string[] }> {
  const results: Array<{ content: string; tags: string[] }> = [];
  const lines = md.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("- ")) continue;

    const content = line.slice(2).trim();
    if (!content) continue;

    // Check next line for tags
    let tags: string[] = [];
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const tagMatch = nextLine.match(/^>\s*Tags:\s*(.+)$/i);
      if (tagMatch) {
        tags = tagMatch[1].split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
        i++; // skip tag line
      }
    }
    results.push({ content, tags });
  }
  return results;
}

/**
 * Import memories from parsed data. Skips entries with duplicate content.
 */
export async function importMemories(
  storage: StorageLike,
  data: Array<{ content: string; tags?: string[] }>
): Promise<{ imported: MemoryEntry[]; skipped: number }> {
  const entries = await loadAll(storage);
  const existingContents = new Set(entries.map((e) => e.content.toLowerCase()));
  const imported: MemoryEntry[] = [];
  const now = Date.now();

  for (const item of data) {
    const content = (item.content ?? "").trim();
    if (!content) continue;
    if (existingContents.has(content.toLowerCase())) continue;

    const entry: MemoryEntry = {
      id: `mem-${now}-${Math.random().toString(16).slice(2, 8)}`,
      content,
      tags: Array.isArray(item.tags) ? item.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [],
      createdAt: now,
      updatedAt: now
    };
    entries.push(entry);
    existingContents.add(content.toLowerCase());
    imported.push(entry);
  }

  if (imported.length > 0) {
    await saveAll(storage, entries);
  }
  return { imported, skipped: data.length - imported.length };
}
