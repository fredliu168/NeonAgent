/**
 * Script-based skills — allows importing and executing JS code as agent tools.
 * Skills can be imported from ClawHub URLs or pasted directly.
 *
 * Script code format (CommonJS-style):
 * ```js
 * exports.tool_name = async function(args, env) {
 *   const resp = await fetch("https://api.example.com/...");
 *   return JSON.stringify(await resp.json());
 * };
 * ```
 *
 * Available globals inside scripts: env, fetch, console, JSON, Math, Date,
 * URL, URLSearchParams, TextEncoder, TextDecoder, btoa, atob, setTimeout.
 */

import type { StorageLike } from "./storage.js";
import type { ToolDefinition } from "./agentTypes.js";

// ── Types ──

export interface ScriptSkillToolDef {
  /** Tool name — must be unique across all script skills */
  name: string;
  /** Tool description shown to the LLM */
  description: string;
  /** JSON Schema for parameters */
  parameters: Record<string, unknown>;
}

export interface ScriptSkill {
  id: string;
  name: string;
  description: string;
  /** The JavaScript source code */
  code: string;
  /** Tool definitions this skill provides */
  tools: ScriptSkillToolDef[];
  /** Environment variables / configuration for the script */
  envVars: Record<string, string>;
  /** Where the skill was imported from (ClawHub URL, etc.) */
  sourceUrl?: string;
  tags: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  lastUsedAt: number | null;
}

// ── Storage ──

const STORAGE_KEY = "neonagent.script_skills";

async function loadAll(storage: StorageLike): Promise<ScriptSkill[]> {
  const raw = await storage.get<ScriptSkill[]>(STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw;
}

async function saveAll(storage: StorageLike, skills: ScriptSkill[]): Promise<void> {
  await storage.set(STORAGE_KEY, skills);
}

export async function getAllScriptSkills(storage: StorageLike): Promise<ScriptSkill[]> {
  return loadAll(storage);
}

export async function getScriptSkillById(
  storage: StorageLike,
  id: string
): Promise<ScriptSkill | undefined> {
  const skills = await loadAll(storage);
  return skills.find((s) => s.id === id);
}

export async function getScriptSkillByName(
  storage: StorageLike,
  name: string
): Promise<ScriptSkill | undefined> {
  const skills = await loadAll(storage);
  return skills.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
}

/**
 * Find which script skill owns a given tool name.
 */
export async function findScriptSkillByToolName(
  storage: StorageLike,
  toolName: string
): Promise<ScriptSkill | undefined> {
  const skills = await loadAll(storage);
  return skills.find((s) => s.tools.some((t) => t.name === toolName));
}

export async function createScriptSkill(
  storage: StorageLike,
  data: {
    name: string;
    description: string;
    code: string;
    tools: ScriptSkillToolDef[];
    envVars?: Record<string, string>;
    sourceUrl?: string;
    tags?: string[];
  }
): Promise<ScriptSkill> {
  const skills = await loadAll(storage);

  const name = data.name.trim();
  if (!name) throw new Error("Skill name is required");
  if (!data.code.trim()) throw new Error("Skill code is required");
  if (data.tools.length === 0) throw new Error("At least one tool definition is required");

  // Check duplicate name
  if (skills.find((s) => s.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`Script skill "${name}" already exists`);
  }

  // Check tool name conflicts across all script skills
  const existingToolNames = new Set(skills.flatMap((s) => s.tools.map((t) => t.name)));
  for (const tool of data.tools) {
    if (existingToolNames.has(tool.name)) {
      throw new Error(`Tool name "${tool.name}" already exists in another script skill`);
    }
  }

  // Validate code can be parsed
  validateScriptCode(data.code);

  const now = Date.now();
  const skill: ScriptSkill = {
    id: `sskill-${now}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    description: data.description.trim(),
    code: data.code,
    tools: data.tools,
    envVars: data.envVars ?? {},
    sourceUrl: data.sourceUrl,
    tags: (data.tags ?? []).map((t) => t.trim().toLowerCase()),
    version: 1,
    createdAt: now,
    updatedAt: now,
    usageCount: 0,
    lastUsedAt: null
  };

  skills.push(skill);
  await saveAll(storage, skills);
  return skill;
}

export async function updateScriptSkill(
  storage: StorageLike,
  id: string,
  updates: {
    name?: string;
    description?: string;
    code?: string;
    tools?: ScriptSkillToolDef[];
    envVars?: Record<string, string>;
    tags?: string[];
  }
): Promise<ScriptSkill> {
  const skills = await loadAll(storage);
  const index = skills.findIndex((s) => s.id === id);
  if (index === -1) throw new Error(`Script skill not found: ${id}`);

  // Check name uniqueness if renaming
  if (updates.name) {
    const dup = skills.find(
      (s, i) => i !== index && s.name.toLowerCase() === updates.name!.trim().toLowerCase()
    );
    if (dup) throw new Error(`Script skill "${updates.name.trim()}" already exists`);
  }

  // Check tool name conflicts if updating tools
  if (updates.tools) {
    const otherToolNames = new Set(
      skills.filter((_, i) => i !== index).flatMap((s) => s.tools.map((t) => t.name))
    );
    for (const tool of updates.tools) {
      if (otherToolNames.has(tool.name)) {
        throw new Error(`Tool name "${tool.name}" already exists in another script skill`);
      }
    }
  }

  if (updates.code) {
    validateScriptCode(updates.code);
  }

  const skill = skills[index];
  skills[index] = {
    ...skill,
    name: updates.name?.trim() ?? skill.name,
    description: updates.description?.trim() ?? skill.description,
    code: updates.code ?? skill.code,
    tools: updates.tools ?? skill.tools,
    envVars: updates.envVars ?? skill.envVars,
    tags: updates.tags ? updates.tags.map((t) => t.trim().toLowerCase()) : skill.tags,
    version: skill.version + 1,
    updatedAt: Date.now()
  };

  await saveAll(storage, skills);
  return skills[index];
}

export async function deleteScriptSkill(
  storage: StorageLike,
  id: string
): Promise<boolean> {
  const skills = await loadAll(storage);
  const filtered = skills.filter((s) => s.id !== id);
  if (filtered.length === skills.length) return false;
  await saveAll(storage, filtered);
  return true;
}

export async function recordScriptSkillUsage(
  storage: StorageLike,
  id: string
): Promise<void> {
  const skills = await loadAll(storage);
  const index = skills.findIndex((s) => s.id === id);
  if (index === -1) return;
  skills[index] = {
    ...skills[index],
    usageCount: skills[index].usageCount + 1,
    lastUsedAt: Date.now()
  };
  await saveAll(storage, skills);
}

// ── Script Validation ──

/**
 * Basic validation of script code.
 * Checks for dangerous patterns. Syntax errors are caught at execution time
 * in the sandbox environment (new Function is not available under extension CSP).
 */
export function validateScriptCode(code: string): void {
  if (!code || !code.trim()) {
    throw new Error("Script code cannot be empty");
  }
  // Check for obviously dangerous patterns
  const dangerous = [
    /\bimportScripts\b/,
    /\beval\b\s*\(/,
    /\bnew\s+Function\b/
  ];
  for (const pattern of dangerous) {
    if (pattern.test(code)) {
      throw new Error(`Script contains disallowed pattern: ${pattern.source}`);
    }
  }
  // Check for basic structural validity (must contain exports assignment)
  if (!/\bexports\s*[.[=]/.test(code)) {
    throw new Error("Script code must use 'exports' to define tool functions (e.g. exports.toolName = function(...) { ... })");
  }
}

// ── Script Execution Runtime ──

/**
 * Execute a tool from a script skill.
 * Runs the code in a sandboxed Function with limited globals.
 */
export async function executeScriptSkillTool(
  skill: ScriptSkill,
  toolName: string,
  args: Record<string, unknown>,
  fetcher: typeof fetch = globalThis.fetch
): Promise<string> {
  // Validate the tool exists in this skill
  const toolDef = skill.tools.find((t) => t.name === toolName);
  if (!toolDef) {
    throw new Error(`Tool "${toolName}" not found in script skill "${skill.name}"`);
  }

  // Create a safe console proxy
  const logs: string[] = [];
  const safeConsole = {
    log: (...a: unknown[]) => logs.push(a.map(String).join(" ")),
    warn: (...a: unknown[]) => logs.push("[WARN] " + a.map(String).join(" ")),
    error: (...a: unknown[]) => logs.push("[ERROR] " + a.map(String).join(" ")),
    info: (...a: unknown[]) => logs.push(a.map(String).join(" "))
  };

  // Create a safe fetch wrapper with timeout
  const safeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetcher(
        input,
        { ...init, signal: controller.signal }
      );
      return resp;
    } finally {
      clearTimeout(timeout);
    }
  };

  // Execute the script code to collect exports
  const exportsObj: Record<string, unknown> = {};
  try {
    const fn = new Function(
      "exports", "env", "fetch", "console",
      "JSON", "Math", "Date", "URL", "URLSearchParams",
      "TextEncoder", "TextDecoder", "btoa", "atob",
      "setTimeout", "encodeURIComponent", "decodeURIComponent",
      skill.code
    );
    fn(
      exportsObj,
      { ...skill.envVars },
      safeFetch,
      safeConsole,
      JSON, Math, Date, URL, URLSearchParams,
      TextEncoder, TextDecoder,
      typeof btoa !== "undefined" ? btoa : undefined,
      typeof atob !== "undefined" ? atob : undefined,
      setTimeout,
      encodeURIComponent, decodeURIComponent
    );
  } catch (e) {
    throw new Error(`Script initialization error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Find the tool handler
  const handler = exportsObj[toolName];
  if (typeof handler !== "function") {
    throw new Error(`Script skill "${skill.name}" does not export function "${toolName}"`);
  }

  // Execute the handler
  try {
    const result = await handler(args, { ...skill.envVars });
    const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    // Append logs if any
    if (logs.length > 0) {
      return output + "\n\n[Script logs]\n" + logs.join("\n");
    }
    return output;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    if (logs.length > 0) {
      throw new Error(`${errorMsg}\n[Script logs]\n${logs.join("\n")}`);
    }
    throw new Error(errorMsg);
  }
}

// ── Tool Definition Generation ──

/**
 * Generate OpenAI-compatible tool definitions from all script skills.
 */
export function generateScriptSkillToolDefs(skills: ScriptSkill[]): ToolDefinition[] {
  const defs: ToolDefinition[] = [];
  for (const skill of skills) {
    for (const tool of skill.tools) {
      defs.push({
        type: "function",
        function: {
          name: tool.name,
          description: `[脚本技能: ${skill.name}] ${tool.description}`,
          parameters: tool.parameters
        }
      });
    }
  }
  return defs;
}

/**
 * Collect all tool names from script skills (for routing in agent loop).
 */
export function getScriptSkillToolNames(skills: ScriptSkill[]): Set<string> {
  const names = new Set<string>();
  for (const skill of skills) {
    for (const tool of skill.tools) {
      names.add(tool.name);
    }
  }
  return names;
}

// ── Prompt Formatting ──

/**
 * Format script skills for system prompt injection.
 */
export function formatScriptSkillsForPrompt(skills: ScriptSkill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => {
    const toolNames = s.tools.map((t) => t.name).join(", ");
    const tagStr = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
    const usage = s.usageCount > 0 ? ` (已使用 ${s.usageCount} 次)` : "";
    const source = s.sourceUrl ? ` (来源: ${s.sourceUrl})` : "";
    return `- **${s.name}** (id: ${s.id}): ${s.description}${tagStr}${usage}${source}\n  提供工具: ${toolNames}`;
  });
  return `# 已安装的脚本技能\n以下是已安装的脚本技能，它们提供了额外的工具，你可以直接调用这些工具：\n${lines.join("\n")}`;
}

// ── ClawHub Import Helper ──

/**
 * Parse a SKILL.md content to extract skill metadata and tool definitions.
 * This handles the ClawHub SKILL.md format with YAML frontmatter.
 */
export function parseSkillMd(md: string): {
  name: string;
  description: string;
  tools: ScriptSkillToolDef[];
  envVars: string[];
  tags: string[];
} | null {
  const text = md.trim();
  if (!text) return null;

  // Extract YAML frontmatter
  let name = "";
  let description = "";
  const envVars: string[] = [];
  const tags: string[] = [];

  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim();
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    if (descMatch) description = descMatch[1].trim();
  }

  // Fall back to H1 for name
  if (!name) {
    const h1Match = text.match(/^#\s+(.+)$/m);
    if (h1Match) name = h1Match[1].trim();
  }

  // Extract description from first paragraph after H1 if not in frontmatter
  if (!description) {
    const afterH1 = text.replace(/^---[\s\S]*?---\s*/, "").replace(/^#\s+.+\n+/, "");
    const firstParagraph = afterH1.split(/\n\n/)[0];
    if (firstParagraph) description = firstParagraph.trim();
  }

  // Extract tool definitions from ## Tools section
  const tools: ScriptSkillToolDef[] = [];
  const toolsSection = text.match(/## Tools\s*\n([\s\S]*?)(?=\n## |\n---|$)/);
  if (toolsSection) {
    const toolBlocks = toolsSection[1].split(/### /);
    for (const block of toolBlocks) {
      if (!block.trim()) continue;
      const lines = block.trim().split("\n");
      const toolName = lines[0]
        .trim()
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .toLowerCase();
      if (!toolName) continue;

      // Extract description
      let toolDesc = "";
      const descLines: string[] = [];
      let i = 1;
      for (; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("Args:") || line.startsWith("`") || !line) {
          if (descLines.length > 0) break;
          continue;
        }
        descLines.push(line);
      }
      toolDesc = descLines.join(" ");

      // Extract parameters from Args section
      const properties: Record<string, unknown> = {};
      const argsMatch = block.match(/Args:\s*\n([\s\S]*?)(?=\nExample:|\n###|$)/);
      if (argsMatch) {
        const argLines = argsMatch[1].trim().split("\n");
        for (const argLine of argLines) {
          const argMatch = argLine.match(/`(\w+)`\s*\((\w+)(?:,\s*(.+?))?\)\s*-\s*(.+)/);
          if (argMatch) {
            const [, argName, argType, argDefault, argDesc] = argMatch;
            properties[argName] = {
              type: argType === "boolean" ? "boolean" :
                    argType === "integer" || argType === "number" ? argType : "string",
              description: argDesc.trim() + (argDefault ? ` (default: ${argDefault.replace(/^default:\s*/, "")})` : "")
            };
          }
        }
      }

      tools.push({
        name: toolName,
        description: toolDesc || `${toolName} tool`,
        parameters: {
          type: "object",
          properties,
          required: [] as string[],
          additionalProperties: false
        }
      });
    }
  }

  // Extract env vars from ## Configuration section
  const configSection = text.match(/## Configuration\s*\n([\s\S]*?)(?=\n## |\n---|$)/);
  if (configSection) {
    const envMatches = configSection[1].matchAll(/`([A-Z][A-Z_0-9]+)`/g);
    for (const m of envMatches) {
      if (!envVars.includes(m[1])) envVars.push(m[1]);
    }
  }

  if (!name) return null;

  return { name, description, tools, envVars, tags };
}

/**
 * Import a script skill from ClawHub-style data.
 * Accepts skill metadata + code, stores it.
 */
export async function importScriptSkillFromData(
  storage: StorageLike,
  data: {
    name: string;
    description: string;
    code: string;
    tools: ScriptSkillToolDef[];
    envVars?: Record<string, string>;
    sourceUrl?: string;
    tags?: string[];
  }
): Promise<ScriptSkill> {
  return createScriptSkill(storage, data);
}

export async function listScriptSkills(
  storage: StorageLike,
  query?: string
): Promise<ScriptSkill[]> {
  const skills = await loadAll(storage);
  if (!query || !query.trim()) return skills;
  const q = query.toLowerCase();
  const keywords = q.split(/\s+/).filter(Boolean);
  return skills.filter((skill) => {
    const text = `${skill.name} ${skill.description} ${skill.tags.join(" ")} ${skill.tools.map((t) => t.name).join(" ")}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw));
  });
}
