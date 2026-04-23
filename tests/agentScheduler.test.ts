import { describe, it, expect, beforeEach } from "vitest";
import type { StorageLike } from "../src/shared/storage.js";
import {
  createScheduledTask,
  listScheduledTasks,
  getScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  recordTaskRun,
  getAllScheduledTasks,
  formatScheduledTasksForPrompt,
  computeAlarmParams,
  getAlarmName,
  parseAlarmName
} from "../src/shared/agentScheduler.js";

function makeStorage(): StorageLike {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return store.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    }
  };
}

describe("agentScheduler", () => {
  let storage: StorageLike;

  beforeEach(() => {
    storage = makeStorage();
  });

  // ── CRUD ──

  it("creates a scheduled task", async () => {
    const task = await createScheduledTask(storage, {
      name: "Daily Checkin",
      instruction: "Go to site and click checkin button",
      scheduleType: "daily",
      time: "09:00"
    });

    expect(task.id).toMatch(/^task-/);
    expect(task.name).toBe("Daily Checkin");
    expect(task.instruction).toBe("Go to site and click checkin button");
    expect(task.scheduleType).toBe("daily");
    expect(task.time).toBe("09:00");
    expect(task.enabled).toBe(true);
    expect(task.runCount).toBe(0);
    expect(task.lastRunAt).toBeNull();
  });

  it("rejects duplicate task names", async () => {
    await createScheduledTask(storage, {
      name: "My Task",
      instruction: "do something",
      scheduleType: "daily",
      time: "10:00"
    });

    await expect(
      createScheduledTask(storage, {
        name: "My Task",
        instruction: "other",
        scheduleType: "daily",
        time: "11:00"
      })
    ).rejects.toThrow(/already exists/);
  });

  it("validates interval scheduleType requires intervalMinutes", async () => {
    await expect(
      createScheduledTask(storage, {
        name: "Bad Interval",
        instruction: "x",
        scheduleType: "interval",
        time: ""
      })
    ).rejects.toThrow(/intervalMinutes/);
  });

  it("validates weekly scheduleType requires dayOfWeek", async () => {
    await expect(
      createScheduledTask(storage, {
        name: "Bad Weekly",
        instruction: "x",
        scheduleType: "weekly",
        time: "09:00"
      })
    ).rejects.toThrow(/dayOfWeek/);
  });

  it("validates daily time format", async () => {
    await expect(
      createScheduledTask(storage, {
        name: "Bad Daily",
        instruction: "x",
        scheduleType: "daily",
        time: "invalid"
      })
    ).rejects.toThrow(/HH:mm/);
  });

  it("validates once time format", async () => {
    await expect(
      createScheduledTask(storage, {
        name: "Bad Once",
        instruction: "x",
        scheduleType: "once",
        time: "not-a-date"
      })
    ).rejects.toThrow(/ISO/);
  });

  it("lists all tasks", async () => {
    await createScheduledTask(storage, {
      name: "Task A",
      instruction: "a",
      scheduleType: "daily",
      time: "08:00"
    });
    await createScheduledTask(storage, {
      name: "Task B",
      instruction: "b",
      scheduleType: "interval",
      time: "",
      intervalMinutes: 30
    });

    const all = await listScheduledTasks(storage);
    expect(all).toHaveLength(2);
  });

  it("filters tasks by keyword", async () => {
    await createScheduledTask(storage, {
      name: "Daily Checkin",
      instruction: "click checkin",
      scheduleType: "daily",
      time: "09:00"
    });
    await createScheduledTask(storage, {
      name: "Weekly Report",
      instruction: "generate report",
      scheduleType: "weekly",
      time: "10:00",
      dayOfWeek: 1
    });

    const results = await listScheduledTasks(storage, "checkin");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Daily Checkin");
  });

  it("gets task by id", async () => {
    const task = await createScheduledTask(storage, {
      name: "Test",
      instruction: "x",
      scheduleType: "daily",
      time: "12:00"
    });

    const found = await getScheduledTask(storage, task.id);
    expect(found?.name).toBe("Test");

    const notFound = await getScheduledTask(storage, "nonexistent");
    expect(notFound).toBeUndefined();
  });

  it("updates a task", async () => {
    const task = await createScheduledTask(storage, {
      name: "Original",
      instruction: "x",
      scheduleType: "daily",
      time: "09:00"
    });

    const updated = await updateScheduledTask(storage, task.id, {
      name: "Updated",
      enabled: false
    });

    expect(updated.name).toBe("Updated");
    expect(updated.enabled).toBe(false);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(task.updatedAt);
  });

  it("update rejects duplicate names", async () => {
    await createScheduledTask(storage, {
      name: "A",
      instruction: "x",
      scheduleType: "daily",
      time: "09:00"
    });
    const b = await createScheduledTask(storage, {
      name: "B",
      instruction: "y",
      scheduleType: "daily",
      time: "10:00"
    });

    await expect(
      updateScheduledTask(storage, b.id, { name: "A" })
    ).rejects.toThrow(/already exists/);
  });

  it("deletes a task", async () => {
    const task = await createScheduledTask(storage, {
      name: "ToDelete",
      instruction: "x",
      scheduleType: "daily",
      time: "09:00"
    });

    expect(await deleteScheduledTask(storage, task.id)).toBe(true);
    expect(await deleteScheduledTask(storage, task.id)).toBe(false);

    const all = await getAllScheduledTasks(storage);
    expect(all).toHaveLength(0);
  });

  // ── Run Recording ──

  it("records task execution", async () => {
    const task = await createScheduledTask(storage, {
      name: "Tracked",
      instruction: "x",
      scheduleType: "daily",
      time: "09:00"
    });

    await recordTaskRun(storage, task.id, "Success");
    await recordTaskRun(storage, task.id, "Success again");

    const found = await getScheduledTask(storage, task.id);
    expect(found!.runCount).toBe(2);
    expect(found!.lastRunAt).toBeGreaterThan(0);
    expect(found!.lastRunResult).toBe("Success again");
  });

  // ── Formatting ──

  it("formatScheduledTasksForPrompt returns undefined for empty", () => {
    expect(formatScheduledTasksForPrompt([])).toBeUndefined();
  });

  it("formatScheduledTasksForPrompt returns formatted list", async () => {
    const task = await createScheduledTask(storage, {
      name: "Daily Test",
      instruction: "do stuff",
      scheduleType: "daily",
      time: "08:30"
    });

    const tasks = await getAllScheduledTasks(storage);
    const result = formatScheduledTasksForPrompt(tasks);
    expect(result).toContain("# 定时任务");
    expect(result).toContain("Daily Test");
    expect(result).toContain(task.id);
    expect(result).toContain("每天 08:30 执行");
  });

  // ── Alarm Params ──

  it("computeAlarmParams for interval", async () => {
    const task = await createScheduledTask(storage, {
      name: "Interval",
      instruction: "x",
      scheduleType: "interval",
      time: "",
      intervalMinutes: 15
    });
    const params = computeAlarmParams(task);
    expect(params.periodInMinutes).toBe(15);
    expect(params.when).toBeUndefined();
  });

  it("computeAlarmParams for daily", async () => {
    const task = await createScheduledTask(storage, {
      name: "Daily",
      instruction: "x",
      scheduleType: "daily",
      time: "09:00"
    });
    const params = computeAlarmParams(task);
    expect(params.when).toBeGreaterThan(0);
    expect(params.periodInMinutes).toBe(24 * 60);
  });

  it("computeAlarmParams for weekly", async () => {
    const task = await createScheduledTask(storage, {
      name: "Weekly",
      instruction: "x",
      scheduleType: "weekly",
      time: "10:00",
      dayOfWeek: 3
    });
    const params = computeAlarmParams(task);
    expect(params.when).toBeGreaterThan(0);
    expect(params.periodInMinutes).toBe(7 * 24 * 60);
  });

  it("computeAlarmParams for once", async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    const task = await createScheduledTask(storage, {
      name: "Once",
      instruction: "x",
      scheduleType: "once",
      time: future
    });
    const params = computeAlarmParams(task);
    expect(params.when).toBeGreaterThan(Date.now());
    expect(params.periodInMinutes).toBeUndefined();
  });

  // ── Alarm Name Helpers ──

  it("getAlarmName and parseAlarmName round-trip", () => {
    const name = getAlarmName("task-123-abc");
    expect(name).toBe("neonagent.task.task-123-abc");
    expect(parseAlarmName(name)).toBe("task-123-abc");
    expect(parseAlarmName("unrelated-alarm")).toBeNull();
  });

  // ── Schedule Type Validation ──

  it("creates interval task with valid params", async () => {
    const task = await createScheduledTask(storage, {
      name: "Poller",
      instruction: "check status",
      scheduleType: "interval",
      time: "",
      intervalMinutes: 5
    });
    expect(task.scheduleType).toBe("interval");
    expect(task.intervalMinutes).toBe(5);
  });

  it("creates weekly task with valid params", async () => {
    const task = await createScheduledTask(storage, {
      name: "Monday Report",
      instruction: "generate report",
      scheduleType: "weekly",
      time: "14:00",
      dayOfWeek: 1
    });
    expect(task.scheduleType).toBe("weekly");
    expect(task.dayOfWeek).toBe(1);
    expect(task.time).toBe("14:00");
  });

  it("creates once task with valid future date", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const task = await createScheduledTask(storage, {
      name: "One Shot",
      instruction: "x",
      scheduleType: "once",
      time: future
    });
    expect(task.scheduleType).toBe("once");
  });
});
