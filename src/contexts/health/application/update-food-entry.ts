import type { DietLogRepository, UpdateFoodEntryPatch } from "../domain/diet-log-repository";
import type { FoodEntry } from "../domain/food-entry";

/** Thrown when an update patch has no updatable fields (D3 in design.md). */
export class EmptyUpdateError extends Error {}

function isEmptyPatch(patch: UpdateFoodEntryPatch): boolean {
  return patch.name === undefined && patch.meal === undefined && patch.eatenAt === undefined && patch.portions === undefined;
}

/** Use case: update one of the user's own food entries. Returns null if not owned/found. */
export async function updateFoodEntry(
  repository: DietLogRepository,
  userId: string,
  entryId: string,
  patch: UpdateFoodEntryPatch,
): Promise<FoodEntry | null> {
  if (isEmptyPatch(patch)) {
    throw new EmptyUpdateError("update must include at least one field");
  }
  return repository.update(userId, entryId, patch);
}
