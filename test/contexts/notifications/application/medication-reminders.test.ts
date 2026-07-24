import { beforeEach, describe, expect, it } from "vitest";
import {
  createMedicationReminder,
  deleteMedicationReminder,
  InvalidReminderScheduleError,
  listMedicationReminders,
  updateMedicationReminder,
} from "../../../../src/contexts/notifications/application/medication-reminders";
import type {
  ActiveReminderSchedule,
  CreateReminderScheduleInput,
  ReminderSchedule,
  ReminderScheduleRepository,
  UpdateReminderSchedulePatch,
} from "../../../../src/contexts/notifications/domain/reminder-schedule";

class InMemoryReminderScheduleRepository implements ReminderScheduleRepository {
  private byId = new Map<string, ReminderSchedule>();
  private nextId = 1;

  async create(input: CreateReminderScheduleInput): Promise<ReminderSchedule> {
    const schedule: ReminderSchedule = { id: `sched-${this.nextId++}`, ...input };
    this.byId.set(schedule.id, schedule);
    return schedule;
  }

  async listByUser(userId: string): Promise<ReminderSchedule[]> {
    return [...this.byId.values()].filter((s) => s.userId === userId);
  }

  async get(id: string): Promise<ReminderSchedule | null> {
    return this.byId.get(id) ?? null;
  }

  async update(id: string, userId: string, patch: UpdateReminderSchedulePatch): Promise<ReminderSchedule | null> {
    const existing = this.byId.get(id);
    if (!existing || existing.userId !== userId) return null;
    const updated: ReminderSchedule = { ...existing, ...patch };
    this.byId.set(id, updated);
    return updated;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const existing = this.byId.get(id);
    if (!existing || existing.userId !== userId) return false;
    this.byId.delete(id);
    return true;
  }

  async listActiveAll(): Promise<ActiveReminderSchedule[]> {
    throw new Error("not used by these tests");
  }
}

const VALID_INPUT = {
  userId: "user-1",
  label: "降血壓藥",
  times: ["08:00", "20:00"],
  daysOfWeek: [1, 3, 5],
  weekInterval: 1,
  anchorDate: "2026-07-01",
  enabled: true,
};

let repo: InMemoryReminderScheduleRepository;

beforeEach(() => {
  repo = new InMemoryReminderScheduleRepository();
});

describe("createMedicationReminder", () => {
  it("creates and stores a medication schedule (category forced to 'medication')", async () => {
    const created = await createMedicationReminder(repo, VALID_INPUT);

    expect(created).toMatchObject({ ...VALID_INPUT, category: "medication" });
    expect(created.id).toBeTruthy();
  });

  it("rejects a times entry that is not HH:mm", async () => {
    await expect(createMedicationReminder(repo, { ...VALID_INPUT, times: ["8:00"] })).rejects.toBeInstanceOf(
      InvalidReminderScheduleError,
    );
    await expect(createMedicationReminder(repo, { ...VALID_INPUT, times: ["25:00"] })).rejects.toBeInstanceOf(
      InvalidReminderScheduleError,
    );
  });

  it("rejects an empty times array", async () => {
    await expect(createMedicationReminder(repo, { ...VALID_INPUT, times: [] })).rejects.toBeInstanceOf(
      InvalidReminderScheduleError,
    );
  });

  it("rejects a days_of_week entry outside 0-6", async () => {
    await expect(createMedicationReminder(repo, { ...VALID_INPUT, daysOfWeek: [7] })).rejects.toBeInstanceOf(
      InvalidReminderScheduleError,
    );
    await expect(createMedicationReminder(repo, { ...VALID_INPUT, daysOfWeek: [-1] })).rejects.toBeInstanceOf(
      InvalidReminderScheduleError,
    );
  });

  it("rejects an empty days_of_week array", async () => {
    await expect(createMedicationReminder(repo, { ...VALID_INPUT, daysOfWeek: [] })).rejects.toBeInstanceOf(
      InvalidReminderScheduleError,
    );
  });

  it("rejects a week_interval below 1", async () => {
    await expect(createMedicationReminder(repo, { ...VALID_INPUT, weekInterval: 0 })).rejects.toBeInstanceOf(
      InvalidReminderScheduleError,
    );
  });

  it("rejects an anchor_date that is not a real date", async () => {
    await expect(createMedicationReminder(repo, { ...VALID_INPUT, anchorDate: "2026-02-30" })).rejects.toBeInstanceOf(
      InvalidReminderScheduleError,
    );
    await expect(createMedicationReminder(repo, { ...VALID_INPUT, anchorDate: "not-a-date" })).rejects.toBeInstanceOf(
      InvalidReminderScheduleError,
    );
  });
});

describe("listMedicationReminders", () => {
  it("returns only the caller's schedules", async () => {
    await createMedicationReminder(repo, VALID_INPUT);
    await createMedicationReminder(repo, { ...VALID_INPUT, userId: "user-2", label: "other" });

    const list = await listMedicationReminders(repo, "user-1");

    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe("user-1");
  });
});

describe("updateMedicationReminder", () => {
  it("updates only the given fields, including toggling enabled", async () => {
    const created = await createMedicationReminder(repo, VALID_INPUT);

    const updated = await updateMedicationReminder(repo, created.id, "user-1", { enabled: false });

    expect(updated).toMatchObject({ ...VALID_INPUT, enabled: false });
  });

  it("validates a provided field just as create does", async () => {
    const created = await createMedicationReminder(repo, VALID_INPUT);

    await expect(
      updateMedicationReminder(repo, created.id, "user-1", { times: ["not-a-time"] }),
    ).rejects.toBeInstanceOf(InvalidReminderScheduleError);
  });

  it("does not affect a reminder not owned by the caller", async () => {
    const created = await createMedicationReminder(repo, VALID_INPUT);

    const result = await updateMedicationReminder(repo, created.id, "someone-else", { enabled: false });

    expect(result).toBeNull();
    expect((await repo.get(created.id))?.enabled).toBe(true);
  });

  it("does not affect a same-owner schedule of a different category (e.g. rehab)", async () => {
    const rehab = await repo.create({ ...VALID_INPUT, category: "rehab" });

    const result = await updateMedicationReminder(repo, rehab.id, "user-1", { enabled: false });

    expect(result).toBeNull();
    expect((await repo.get(rehab.id))?.enabled).toBe(true);
  });
});

describe("deleteMedicationReminder", () => {
  it("deletes an owned reminder", async () => {
    const created = await createMedicationReminder(repo, VALID_INPUT);

    const deleted = await deleteMedicationReminder(repo, created.id, "user-1");

    expect(deleted).toBe(true);
    expect(await repo.get(created.id)).toBeNull();
  });

  it("does not delete a reminder not owned by the caller", async () => {
    const created = await createMedicationReminder(repo, VALID_INPUT);

    const deleted = await deleteMedicationReminder(repo, created.id, "someone-else");

    expect(deleted).toBe(false);
    expect(await repo.get(created.id)).not.toBeNull();
  });

  it("does not delete a same-owner schedule of a different category (e.g. rehab)", async () => {
    const rehab = await repo.create({ ...VALID_INPUT, category: "rehab" });

    const deleted = await deleteMedicationReminder(repo, rehab.id, "user-1");

    expect(deleted).toBe(false);
    expect(await repo.get(rehab.id)).not.toBeNull();
  });
});
