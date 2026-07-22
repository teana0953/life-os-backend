import type { BowelLog } from "../domain/bowel";
import type { SetBowelLogInput, BowelRepository } from "../domain/bowel-repository";

/** Use case: set (upsert) a day's whole bowel record. */
export async function setBowelDay(repository: BowelRepository, input: SetBowelLogInput): Promise<BowelLog> {
  return repository.set(input);
}
