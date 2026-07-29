import type { FoodDictionaryRepository, UpdateSharedFoodItemPatch } from "../domain/food-dictionary-repository";
import type { FoodItem } from "../domain/food-item";
import { isValidMeasureBasis } from "../domain/food-item";
import { InvalidFoodItemError } from "./create-shared-food-item";

/**
 * Use case: partial-update a shared food item. Reads the current item via
 * `findSharedById` (so a user-owned item id and an unknown id both resolve to
 * `null` identically) and validates the measure-basis invariant against the
 * MERGED post-patch state (D7 in design.md) before writing, so a patch that
 * would strand `base_amount`/`measure_unit` is rejected and nothing is
 * written. Returns `null` for not-found; throws `InvalidFoodItemError`
 * (including for an empty patch) for an invalid request.
 */
export async function updateSharedFoodItem(
  repository: FoodDictionaryRepository,
  id: string,
  patch: UpdateSharedFoodItemPatch,
): Promise<FoodItem | null> {
  if (Object.keys(patch).length === 0) {
    throw new InvalidFoodItemError("at least one field must be supplied");
  }

  const existing = await repository.findSharedById(id);
  if (!existing) return null;

  const mergedBaseAmount = "baseAmount" in patch ? (patch.baseAmount ?? null) : existing.baseAmount;
  const mergedMeasureUnit = "measureUnit" in patch ? (patch.measureUnit ?? null) : existing.measureUnit;
  if (!isValidMeasureBasis(mergedBaseAmount, mergedMeasureUnit)) {
    throw new InvalidFoodItemError("base_amount and measure_unit must be supplied together or not at all");
  }

  return repository.updateSharedById(id, patch);
}
