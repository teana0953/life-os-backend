import type { ModelClient } from "../../../src/contexts/assistant/domain/model-client";
import type { CareItemRepository } from "../../../src/contexts/notifications/domain/care-item";
import type { CareLogRepository } from "../../../src/contexts/notifications/domain/care-log";

function notImplemented(): never {
  throw new Error("not implemented in this test's fakes");
}

/** Stub for route tests that never touch the assistant endpoint (see assistant.test.ts for the scripted fake). */
export const stubModelClient: ModelClient = {
  turn: () => {
    throw new Error("not implemented in this test's fakes");
  },
};

/**
 * Every method throws, so a care read that escapes the assistant's opt-in
 * guard surfaces as a failed request rather than as a quietly empty answer.
 */
export const stubCareItemRepository: CareItemRepository = {
  create: notImplemented,
  listByUser: notImplemented,
  get: notImplemented,
  getByScheduleId: notImplemented,
  update: notImplemented,
  delete: notImplemented,
  listActiveSchedules: notImplemented,
  listActiveSchedulesForUserOn: notImplemented,
  decrementStock: notImplemented,
  incrementStock: notImplemented,
};

export const stubCareLogRepository: CareLogRepository = {
  upsertIfAbsent: notImplemented,
  getBySlot: notImplemented,
  listByUserAndDate: notImplemented,
  listByUserAndDateRange: notImplemented,
  upsert: notImplemented,
};
