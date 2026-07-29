import type { CreateSharedFoodItemInput, FoodDictionaryRepository } from "../domain/food-dictionary-repository";
import type { FoodItem } from "../domain/food-item";
import { isValidMeasureBasis } from "../domain/food-item";

/** Raised when a shared food item's fields are invalid (e.g. a measure basis with only one part supplied). */
export class InvalidFoodItemError extends Error {}

/** Use case: create a shared (no-owner) food item, validating the measure-basis invariant (D7 in design.md). */
export async function createSharedFoodItem(
  repository: FoodDictionaryRepository,
  input: CreateSharedFoodItemInput,
): Promise<FoodItem> {
  if (!isValidMeasureBasis(input.baseAmount, input.measureUnit)) {
    throw new InvalidFoodItemError("base_amount and measure_unit must be supplied together or not at all");
  }
  return repository.createShared(input);
}
