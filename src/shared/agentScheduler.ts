/**
 * Agent scheduled tasks — persistent cron-like tasks that trigger
 * the agent loop on a schedule using chrome.alarms API.
 */

import type { StorageLike } from "./storage.js";

export type ScheduleType = "once" | "interval" | "daily" | "weekly";

export interface ScheduledTask {
  id: string;
  /** Human-readable name */
  name: string;
  /** The agent instruction to execute */
  instruction: string;
  /** Schedule type */
  scheduleType: ScheduleType;
  /** For "once": ISO-format datetime string. For "daily"/"weekly": HH:mm. */
  time: string;
  /** For "weekly": 0=Sun … 6=Sat */
  dayOfWeek?: number;
  /** For "interval": repeat interval in minutes (≥1) */
  intervalMinutes?: number;
  /** Whether the task is active */
  enabled: boolean;
  /** Last execution timestamp (ms) */
  lastRunAt: number | null;
  /** Last execution result summary */
  lastRunResult: string | null;
  /** Total execution count */
  runCount: number;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "neonagent.scheduled_tasks";

async function loadAll(storage: StorageLike): Promise<ScheduledTask[]> {
  const raw = await storage.get<ScheduledTask[]>(STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw;
}

async function saveAll(storage: StorageLike, tasks: ScheduledTask[]): Promise<void> {
  await storage.set(STORAGE_KEY, tasks);
}

/** Create a new scheduled task */
export async function createScheduledTask(
  storage: StorageLike,
  params: {
    name: string;
    instruction: string;
    scheduleType: ScheduleType;
    time: string;
    dayOfWeek?: number;
    intervalMinutes?: number;
  }
): Promise<ScheduledTask> {
  const tasks = await loadAll(storage);

  // Duplicate name check
  const existing = tasks.find(
    (t) => t.name.toLowerCase() === params.name.trim().toLowerCase()
  );
  if (existing) {
    throw new Error(`Task with name "${params.name.trim()}" already exists (id: ${existing.id}).`);
  }

  // Validate params
  validateScheduleParams(params);

  const now = Date.now();
  const task: ScheduledTask = {
    id: `task-${now}-${Math.random().toString(16).slice(2, 8)}`,
    name: params.name.trim(),
    instruction: params.instruction.trim(),
    scheduleType: params.scheduleType,
    time: params.time.trim(),
    dayOfWeek: params.dayOfWeek,
    intervalMinutes: params.intervalMinutes,
    enabled: true,
    lastRunAt: null,
    lastRunResult: null,
    runCount: 0,
    createdAt: now,
    updatedAt: now
  };
  tasks.push(task);
  await saveAll(storage, tasks);
  return task;
}

/** List tasks, optionally filter by query keyword */
export async function listScheduledTasks(
  storage: StorageLike,
  query?: string
): Promise<ScheduledTask[]> {
  const tasks = await loadAll(storage);
  if (!query || !query.trim()) return tasks;

  const q = query.toLowerCase();
  return tasks.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.instruction.toLowerCase().includes(q)
  );
}

/** Get a single task by id */
export async function getScheduledTask(
  storage: StorageLike,
  taskId: string
): Promise<ScheduledTask | undefined> {
  const tasks = await loadAll(storage);
  return tasks.find((t) => t.id === taskId);
}

/** Update a task's properties */
export async function updateScheduledTask(
  storage: StorageLike,
  taskId: string,
  updates: Partial<Pick<ScheduledTask, "name" | "instruction" | "scheduleType" | "time" | "dayOfWeek" | "intervalMinutes" | "enabled">>
): Promise<ScheduledTask> {
  const tasks = await loadAll(storage);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);

  // Duplicate name check
  if (updates.name !== undefined) {
    const dup = tasks.find(
      (t) => t.id !== taskId && t.name.toLowerCase() === updates.name!.trim().toLowerCase()
    );
    if (dup) {
      throw new Error(`Task with name "${updates.name!.trim()}" already exists (id: ${dup.id}).`);
    }
    task.name = updates.name.trim();
  }

  if (updates.instruction !== undefined) task.instruction = updates.instruction.trim();
  if (updates.scheduleType !== undefined) task.scheduleType = updates.scheduleType;
  if (updates.time !== undefined) task.time = updates.time.trim();
  if (updates.dayOfWeek !== undefined) task.dayOfWeek = updates.dayOfWeek;
  if (updates.intervalMinutes !== undefined) task.intervalMinutes = updates.intervalMinutes;
  if (updates.enabled !== undefined) task.enabled = updates.enabled;

  // Validate after merge
  validateScheduleParams(task);

  task.updatedAt = Date.now();
  await saveAll(storage, tasks);
  return task;
}

/** Delete a task by id */
export async function deleteScheduledTask(
  storage: StorageLike,
  taskId: string
): Promise<boolean> {
  const tasks = await loadAll(storage);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  await saveAll(storage, tasks);
  return true;
}

/** Record that a task was executed */
export async function recordTaskRun(
  storage: StorageLike,
  taskId: string,
  result: string
): Promise<void> {
  const tasks = await loadAll(storage);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.lastRunAt = Date.now();
  task.lastRunResult = result.slice(0, 500);
  task.runCount += 1;
  await saveAll(storage, tasks);
}

/** Get all tasks (for system prompt injection) */
export async function getAllScheduledTasks(
  storage: StorageLike
): Promise<ScheduledTask[]> {
  return loadAll(storage);
}

/** Format tasks list for system prompt */
export function formatScheduledTasksForPrompt(tasks: ScheduledTask[]): string | undefined {
  if (tasks.length === 0) return undefined;

  const lines = tasks.map((t) => {
    const status = t.enabled ? "✅" : "⏸️";
    const schedule = describeSchedule(t);
    const lastRun = t.lastRunAt
      ? `上次: ${new Date(t.lastRunAt).toLocaleString("zh-CN")} (共${t.runCount}次)`
      : "尚未执行";
    return `- ${status} **${t.name}** (id: ${t.id}): ${schedule} — ${lastRun}`;
  });

  return `# 定时任务\n以下是你管理的定时任务列表：\n${lines.join("\n")}`;
}

/** Describe schedule in human-readable Chinese */
function describeSchedule(task: ScheduledTask): string {
  switch (task.scheduleType) {
    case "once":
      return `单次执行于 ${task.time}`;
    case "interval":
      return `每 ${task.intervalMinutes} 分钟执行`;
    case "daily":
      return `每天 ${task.time} 执行`;
    case "weekly": {
      const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      return `每${days[task.dayOfWeek ?? 0]} ${task.time} 执行`;
    }
    default:
      return task.scheduleType;
  }
}

/** Calculate chrome.alarms scheduling parameters */
export function computeAlarmParams(task: ScheduledTask): {
  when?: number;
  periodInMinutes?: number;
} {
  const now = Date.now();

  if (task.scheduleType === "interval") {
    return { periodInMinutes: task.intervalMinutes ?? 1 };
  }

  if (task.scheduleType === "once") {
    const target = new Date(task.time).getTime();
    return { when: target > now ? target : now + 1000 };
  }

  if (task.scheduleType === "daily") {
    const when = nextDailyTimestamp(task.time);
    return { when, periodInMinutes: 24 * 60 };
  }

  if (task.scheduleType === "weekly") {
    const when = nextWeeklyTimestamp(task.time, task.dayOfWeek ?? 0);
    return { when, periodInMinutes: 7 * 24 * 60 };
  }

  return {};
}

/** Get the alarm name for a task (used as chrome.alarms key) */
export function getAlarmName(taskId: string): string {
  return `neonagent.task.${taskId}`;
}

/** Extract task id from alarm name */
export function parseAlarmName(alarmName: string): string | null {
  const prefix = "neonagent.task.";
  if (!alarmName.startsWith(prefix)) return null;
  return alarmName.slice(prefix.length);
}

// ── Helpers ──

function nextDailyTimestamp(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function nextWeeklyTimestamp(hhmm: string, dayOfWeek: number): number {
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  const currentDay = now.getDay();
  let diff = dayOfWeek - currentDay;
  if (diff < 0 || (diff === 0 && target.getTime() <= now.getTime())) {
    diff += 7;
  }
  target.setDate(target.getDate() + diff);
  return target.getTime();
}

function validateScheduleParams(params: {
  scheduleType: ScheduleType;
  time: string;
  dayOfWeek?: number;
  intervalMinutes?: number;
}): void {
  const validTypes: ScheduleType[] = ["once", "interval", "daily", "weekly"];
  if (!validTypes.includes(params.scheduleType)) {
    throw new Error(`Invalid scheduleType: ${params.scheduleType}. Must be one of: ${validTypes.join(", ")}`);
  }

  if (params.scheduleType === "interval") {
    if (typeof params.intervalMinutes !== "number" || params.intervalMinutes < 1) {
      throw new Error("intervalMinutes must be a number ≥ 1 for interval schedule.");
    }
  }

  if (params.scheduleType === "daily" || params.scheduleType === "weekly") {
    if (!/^\d{1,2}:\d{2}$/.test(params.time)) {
      throw new Error(`Invalid time format: "${params.time}". Use HH:mm format.`);
    }
  }

  if (params.scheduleType === "weekly") {
    if (typeof params.dayOfWeek !== "number" || params.dayOfWeek < 0 || params.dayOfWeek > 6) {
      throw new Error("dayOfWeek must be 0(Sun)–6(Sat) for weekly schedule.");
    }
  }

  if (params.scheduleType === "once") {
    const parsed = new Date(params.time).getTime();
    if (isNaN(parsed)) {
      throw new Error(`Invalid datetime: "${params.time}". Use ISO format like "2025-01-15T09:00:00".`);
    }
  }
}
