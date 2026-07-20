import type { MealItem } from "../domain/meal-entry";
import type { MealRepository, UpdateMealItemPatch } from "../domain/meal-repository";

/** Thrown when an update patch has no updatable fields. */
export class EmptyUpdateError extends Error {}

function isEmptyPatch(patch: UpdateMealItemPatch): boolean {
  return patch.quantity === undefined && patch.measure === undefined && patch.portions === undefined;
}

/**
 * Use case: update one of the user's own meal items (Model Y, D3). A
 * quantity or measure patch sets only the `quantity` column (per-unit values
 * untouched, no double-scaling); a portions patch sets the per-unit portion
 * columns and recomputes per-unit nutrients, marking the item classified.
 * Returns null if not owned/found.
 */
export async function updateMealItem(
  repository: MealRepository,
  userId: string,
  itemId: string,
  patch: UpdateMealItemPatch,
): Promise<MealItem | null> {
  if (isEmptyPatch(patch)) {
    throw new EmptyUpdateError("update must include at least one field");
  }
  return repository.updateItem(userId, itemId, patch);
}
