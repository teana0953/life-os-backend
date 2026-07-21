import type { WaterTarget } from "../domain/water";
import type { SetWaterTargetInput, WaterRepository } from "../domain/water-repository";

/** Use case: set (upsert) a day's water target. */
export async function setWaterTarget(repository: WaterRepository, input: SetWaterTargetInput): Promise<WaterTarget> {
  return repository.setTarget(input);
}
