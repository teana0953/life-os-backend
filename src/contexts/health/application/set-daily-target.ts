import type { DailyTarget } from "../domain/daily-target";
import type { DailyTargetRepository, SetDailyTargetInput } from "../domain/daily-target-repository";

/** Use case: set (upsert) a day's base portion goals. Bonus defaults to 0 when not given. */
export async function setDailyTarget(repository: DailyTargetRepository, input: SetDailyTargetInput): Promise<DailyTarget> {
  return repository.set(input);
}
