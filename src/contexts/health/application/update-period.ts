import type { MenstrualPeriod } from "../domain/menstrual-period";
import type { MenstrualRepository, UpdatePeriodPatch } from "../domain/menstrual-repository";
import { InvalidPeriodError } from "./add-period";

/**
 * Use case: update one of the user's own periods with partial-update semantics.
 * Finds the owned period (null when not owned/found), merges ONLY the patch's
 * present fields onto it (an absent field keeps the current value; `endDate: null`
 * clears it), validates the merged `endDate == null || endDate >= startDate`
 * (throws on violation), then persists. An empty patch is a no-op that returns
 * the current period (avoids a Drizzle `.set({})`).
 */
export async function updatePeriod(
  repository: MenstrualRepository,
  userId: string,
  id: string,
  patch: UpdatePeriodPatch,
): Promise<MenstrualPeriod | null> {
  const periods = await repository.listByUser(userId);
  const current = periods.find((p) => p.id === id);
  if (!current) return null;

  const startDate = "startDate" in patch && patch.startDate !== undefined ? patch.startDate : current.startDate;
  const endDate = "endDate" in patch ? patch.endDate ?? null : current.endDate;

  if (endDate !== null && endDate < startDate) {
    throw new InvalidPeriodError("end_date must not be earlier than start_date");
  }

  if (!("startDate" in patch) && !("endDate" in patch)) {
    return current;
  }

  return repository.update(userId, id, patch);
}
