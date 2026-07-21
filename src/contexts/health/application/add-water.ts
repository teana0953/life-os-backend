import type { WaterIntake } from "../domain/water";
import type { WaterRepository } from "../domain/water-repository";

/** Use case: add water to a day's total. The stored total is clamped at 0 (a negative amount corrects an over-count). */
export async function addWater(repository: WaterRepository, userId: string, day: string, addMl: number): Promise<WaterIntake> {
  return repository.addIntake(userId, day, addMl);
}
