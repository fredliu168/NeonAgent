/**
 * Agent skills — reusable automated workflows/playbooks that the agent
 * can learn, store, retrieve, execute, and auto-upgrade.
 */

import type { StorageLike } from "./storage.js";

export interface SkillStep {
  /** Natural language instruction for the agent to follow */
  instruction: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  steps: SkillStep[];
  tags: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  lastUsedAt: number | null;
}

const STORAGE_KEY = "neonagent.agent_skills";

async function loadAll(storage: StorageLike): Promise<Skill[]> {
  const raw = await storage.get<Skill[]>(STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw;
}

async function saveAll(storage: StorageLike, skills: Skill[]): Promise<void> {
  await storage.set(STORAGE_KEY, skills);
}

export async function createSkill(
  storage: StorageLike,
  name: string,
  description: string,
  steps: string[],
  tags: string[] = []
): Promise<Skill> {
  const skills = await loadAll(storage);

  // Check for duplicate name
  const existing = skills.find(
    (s) => s.name.toLowerCase() === name.trim().toLowerCase()
  );
  if (existing) {
    throw new Error(`Skill with name "${name.trim()}" already exists (id: ${existing.id}). Use update_skill to modify it.`);
  }

  const now = Date.now();
  const skill: Skill = {
    id: `skill-${now}-${Math.random().toString(16).slice(2, 8)}`,
    name: name.trim(),
    description: description.trim(),
    steps: steps.map((s) => ({ instruction: s.trim() })),
    tags: tags.map((t) => t.trim().toLowerCase()),
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

export async function listSkills(
  storage: StorageLike,
  query?: string
): Promise<Skill[]> {
  const skills = await loadAll(storage);
  if (!query || !query.trim()) return skills;

  const q = query.toLowerCase();
  const keywords = q.split(/\s+/).filter(Boolean);
  return skills.filter((skill) => {
    const text = `${skill.name} ${skill.description} ${skill.tags.join(" ")}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw));
  });
}

export async function getSkillById(
  storage: StorageLike,
  skillId: string
): Promise<Skill | undefined> {
  const skills = await loadAll(storage);
  return skills.find((s) => s.id === skillId);
}

export async function getSkillByName(
  storage: StorageLike,
  name: string
): Promise<Skill | undefined> {
  const skills = await loadAll(storage);
  return skills.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
}

export async function executeSkill(
  storage: StorageLike,
  skillId: string
): Promise<Skill> {
  const skills = await loadAll(storage);
  const index = skills.findIndex((s) => s.id === skillId);
  if (index === -1) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  const skill = skills[index];
  skills[index] = {
    ...skill,
    usageCount: skill.usageCount + 1,
    lastUsedAt: Date.now()
  };
  await saveAll(storage, skills);
  return skills[index];
}

export async function updateSkill(
  storage: StorageLike,
  skillId: string,
  updates: {
    name?: string;
    description?: string;
    steps?: string[];
    tags?: string[];
  }
): Promise<Skill> {
  const skills = await loadAll(storage);
  const index = skills.findIndex((s) => s.id === skillId);
  if (index === -1) {
    throw new Error(`Skill not found: ${skillId}`);
  }

  // Check name uniqueness if renaming
  if (updates.name) {
    const duplicate = skills.find(
      (s, i) => i !== index && s.name.toLowerCase() === updates.name!.trim().toLowerCase()
    );
    if (duplicate) {
      throw new Error(`Skill with name "${updates.name.trim()}" already exists (id: ${duplicate.id}).`);
    }
  }

  const skill = skills[index];
  skills[index] = {
    ...skill,
    name: updates.name?.trim() ?? skill.name,
    description: updates.description?.trim() ?? skill.description,
    steps: updates.steps ? updates.steps.map((s) => ({ instruction: s.trim() })) : skill.steps,
    tags: updates.tags ? updates.tags.map((t) => t.trim().toLowerCase()) : skill.tags,
    version: skill.version + 1,
    updatedAt: Date.now()
  };
  await saveAll(storage, skills);
  return skills[index];
}

export async function deleteSkill(
  storage: StorageLike,
  skillId: string
): Promise<boolean> {
  const skills = await loadAll(storage);
  const filtered = skills.filter((s) => s.id !== skillId);
  if (filtered.length === skills.length) return false;
  await saveAll(storage, filtered);
  return true;
}

export async function getAllSkills(
  storage: StorageLike
): Promise<Skill[]> {
  return loadAll(storage);
}

/**
 * Import skills from an array of exported skill objects.
 * Skips skills whose name already exists; returns the list of newly imported skills.
 */
export async function importSkills(
  storage: StorageLike,
  data: Array<{
    name: string;
    description: string;
    steps: string[] | SkillStep[];
    tags?: string[];
  }>
): Promise<{ imported: Skill[]; skipped: string[] }> {
  const skills = await loadAll(storage);
  const existingNames = new Set(skills.map((s) => s.name.toLowerCase()));
  const imported: Skill[] = [];
  const skipped: string[] = [];
  const now = Date.now();

  for (const item of data) {
    const name = (item.name ?? "").trim();
    if (!name) { skipped.push("(empty name)"); continue; }
    if (existingNames.has(name.toLowerCase())) { skipped.push(name); continue; }

    const steps: SkillStep[] = Array.isArray(item.steps)
      ? item.steps.map((s) =>
          typeof s === "string" ? { instruction: s.trim() } : { instruction: (s as SkillStep).instruction?.trim() ?? "" }
        )
      : [];
    if (steps.length === 0) { skipped.push(name); continue; }

    const skill: Skill = {
      id: `skill-${now}-${Math.random().toString(16).slice(2, 8)}`,
      name,
      description: (item.description ?? "").trim(),
      steps,
      tags: Array.isArray(item.tags) ? item.tags.map((t) => String(t).trim().toLowerCase()) : [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      usageCount: 0,
      lastUsedAt: null
    };
    skills.push(skill);
    existingNames.add(name.toLowerCase());
    imported.push(skill);
  }

  if (imported.length > 0) {
    await saveAll(storage, skills);
  }
  return { imported, skipped };
}

/**
 * Format skills summary for inclusion in the system prompt.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => {
    const tagStr = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
    const usage = s.usageCount > 0 ? ` (已使用 ${s.usageCount} 次)` : "";
    return `- **${s.name}** (id: ${s.id}): ${s.description}${tagStr}${usage}`;
  });
  return `# 已保存的技能\n以下是你之前学到的可复用技能，遇到相似任务时可直接调用：\n${lines.join("\n")}`;
}

/**
 * Format a skill for execution — returns the step-by-step playbook.
 */
export function formatSkillForExecution(skill: Skill): string {
  const header = `执行技能「${skill.name}」(v${skill.version}):\n${skill.description}\n\n步骤：`;
  const steps = skill.steps.map((s, i) => `${i + 1}. ${s.instruction}`);
  return `${header}\n${steps.join("\n")}`;
}

// ── Markdown serialization / deserialization ──

/**
 * Serialize a single skill into Markdown.
 */
export function skillToMarkdown(skill: {
  name: string;
  description: string;
  steps: Array<string | SkillStep>;
  tags?: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# ${skill.name}`);
  lines.push("");
  lines.push(skill.description);
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i];
    const text = typeof step === "string" ? step : step.instruction;
    lines.push(`${i + 1}. ${text}`);
  }
  if (skill.tags && skill.tags.length > 0) {
    lines.push("");
    lines.push("## Tags");
    lines.push("");
    lines.push(skill.tags.join(", "));
  }
  return lines.join("\n");
}

/**
 * Serialize multiple skills into a single Markdown document separated by `---`.
 */
export function skillsToMarkdown(skills: Array<{
  name: string;
  description: string;
  steps: Array<string | SkillStep>;
  tags?: string[];
}>): string {
  return skills.map((s) => skillToMarkdown(s)).join("\n\n---\n\n");
}

/**
 * Parse one Markdown block into skill data.
 * Expected format:
 * ```
 * # Skill Name
 *
 * Description text (may span multiple lines).
 *
 * ## Steps
 *
 * 1. Step one
 * 2. Step two
 *
 * ## Tags
 *
 * tag1, tag2
 * ```
 */
export function parseSkillMarkdown(md: string): {
  name: string;
  description: string;
  steps: string[];
  tags: string[];
} | null {
  const text = md.trim();
  if (!text) return null;

  // Extract name from first H1
  const nameMatch = text.match(/^#\s+(.+)$/m);
  if (!nameMatch) return null;
  const name = nameMatch[1].trim();

  // Split by ## sections
  const sections = new Map<string, string>();
  let currentSection = "__intro__";
  const linesAfterH1: string[] = [];
  let pastH1 = false;
  for (const line of text.split("\n")) {
    if (!pastH1) {
      if (/^#\s+/.test(line)) { pastH1 = true; continue; }
      continue;
    }
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      currentSection = h2Match[1].trim().toLowerCase();
      continue;
    }
    if (currentSection === "__intro__") {
      linesAfterH1.push(line);
    } else {
      const existing = sections.get(currentSection) ?? "";
      sections.set(currentSection, existing ? existing + "\n" + line : line);
    }
  }

  // Description = text between H1 and first H2
  const description = linesAfterH1.join("\n").trim();

  // Steps from ## Steps section
  const stepsRaw = sections.get("steps") ?? "";
  const steps: string[] = [];
  for (const line of stepsRaw.split("\n")) {
    const stepMatch = line.match(/^\d+\.\s+(.+)$/);
    if (stepMatch) {
      steps.push(stepMatch[1].trim());
    }
  }

  // Tags from ## Tags section
  const tagsRaw = (sections.get("tags") ?? "").trim();
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  if (!name || steps.length === 0) return null;

  return { name, description, steps, tags };
}

/**
 * Parse a Markdown document containing one or more skills separated by `---`.
 */
export function parseSkillsMarkdown(md: string): Array<{
  name: string;
  description: string;
  steps: string[];
  tags: string[];
}> {
  // Split by horizontal rule (--- on its own line, possibly with surrounding blank lines)
  const blocks = md.split(/\n---\n/).map((b) => b.trim()).filter(Boolean);
  const results: Array<{
    name: string;
    description: string;
    steps: string[];
    tags: string[];
  }> = [];

  for (const block of blocks) {
    const parsed = parseSkillMarkdown(block);
    if (parsed) results.push(parsed);
  }
  return results;
}
