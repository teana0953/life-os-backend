import type { CareReminderStep } from "../../../../src/contexts/notifications/adapters/care-reminder-loop";

/**
 * Test doubles that model real Cloudflare Workflows API limits a permissive
 * fake never would — the shared lesson from goal.md's Bug A/B (and #99): a
 * step/binding fake that never refuses anything can't distinguish "works" from
 * "works only because the fake is lenient". Each modeled limit below is
 * exercised by at least one test in `care-reminder-loop.test.ts` or
 * `workflows-care-day-instance-manager.test.ts` — an unexercised limit here
 * would itself be an unfalsifiable guard.
 */

/**
 * Strict `CareReminderStep`: a virtual clock advanced only by `sleep`, a
 * step-count ceiling mirroring the Workflows free plan's 3,000 steps/day, and
 * a rejection of any non-positive `sleep` duration (real Workflows rejects a
 * `sleepUntil` for a past instant the same way — this repo's fix eliminates
 * `sleepUntil` entirely in favor of relative `sleep`, so THIS is the shape
 * the same real constraint takes here: exercised by
 * care-reminder-loop.test.ts's "restart-grace: a slot within
 * FIRST_FIRE_GRACE_MINUTES dispatches without any invalid (non-positive)
 * sleep" test, whose mutant is calling `sleep` with a `waitMs <= 0`).
 */
export class StrictWorkflowStep implements CareReminderStep {
  private clock: Date;
  private stepCount = 0;

  constructor(
    initialNow: Date,
    private readonly maxSteps = 3000,
  ) {
    this.clock = initialNow;
  }

  /** The virtual clock: only ever advances via `sleep`, never wall-clock time. */
  now(): Date {
    return this.clock;
  }

  private countStep(): void {
    this.stepCount++;
    if (this.stepCount > this.maxSteps) {
      throw new Error(`step budget exceeded: ${this.stepCount} > ${this.maxSteps} (Cloudflare Workflows free plan's steps/day ceiling)`);
    }
  }

  async do<T>(_name: string, callback: () => Promise<T>): Promise<T> {
    this.countStep();
    return callback();
  }

  async sleep(_name: string, ms: number): Promise<void> {
    this.countStep();
    if (ms <= 0) {
      throw new Error(`Workflows rejects a non-positive sleep duration (${ms}ms) — this is the same real limit "You can't sleep until a time in the past" is a form of`);
    }
    this.clock = new Date(this.clock.getTime() + ms);
  }
}

/**
 * Strict Workflows binding: `create()` rejects ANY id used before (even a
 * terminated one — Cloudflare Workflows instance ids are unique for their
 * whole retention window, not just while running); `get()` rejects an id
 * that was never created; `terminate()` rejects an id that is not currently
 * running (real Workflows returns an error terminating an already-terminated
 * or already-completed instance — modeled here so a fix that calls
 * `terminate()` twice on the same instance can't pass by accident). Mirrors
 * just the two calls `WorkflowsCareDayInstanceManager` makes (`create`,
 * `get(...).terminate()`).
 */
export class StrictWorkflowBinding {
  private readonly everCreated = new Set<string>();
  private readonly running = new Set<string>();
  readonly createCalls: string[] = [];

  async create(opts: { id: string; params: unknown }): Promise<{ id: string }> {
    this.createCalls.push(opts.id);
    if (this.everCreated.has(opts.id)) {
      throw new Error(`Workflows: instance id "${opts.id}" already exists (create() rejects reuse of any id created before, even a terminated one, within the retention window)`);
    }
    this.everCreated.add(opts.id);
    this.running.add(opts.id);
    return { id: opts.id };
  }

  async get(id: string): Promise<{ terminate: () => Promise<void> }> {
    if (!this.everCreated.has(id)) {
      throw new Error(`Workflows: no such instance "${id}"`);
    }
    return {
      terminate: async () => {
        if (!this.running.has(id)) {
          throw new Error(`Workflows: instance "${id}" is not running (already terminated/completed)`);
        }
        // Terminating does not free the id — `create()` above still rejects it.
        this.running.delete(id);
      },
    };
  }

  /** Ids currently running — never created, or created then terminated, are excluded. */
  runningIds(): string[] {
    return [...this.running];
  }
}

/**
 * In-memory `CareDayInstancePointerStore` fake for tests that don't need
 * PGlite: single-row-per-user map, same CAS contract as
 * `DrizzleCareDayInstancePointerStore` — `setCurrentIfMatch` only advances
 * the pointer when the stored `(localDate, instanceId)` still equals
 * `expected`.
 */
export class InMemoryCareDayInstancePointerStore {
  private readonly rows = new Map<string, { localDate: string; instanceId: string }>();

  async getCurrent(userId: string, localDate: string): Promise<string | null> {
    const row = this.rows.get(userId);
    if (!row || row.localDate !== localDate) return null;
    return row.instanceId;
  }

  async setCurrentIfMatch(userId: string, localDate: string, expected: string | null, newInstanceId: string): Promise<boolean> {
    const row = this.rows.get(userId);
    const current = row && row.localDate === localDate ? row.instanceId : null;
    if (current !== expected) return false;
    this.rows.set(userId, { localDate, instanceId: newInstanceId });
    return true;
  }
}
