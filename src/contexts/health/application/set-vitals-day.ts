import type { VitalsRecord } from "../domain/vitals";
import type { SetVitalsInput, VitalsRepository } from "../domain/vitals-repository";

/** Use case: set (upsert) a day's whole vitals record (scalars + all three lists). */
export async function setVitalsDay(repository: VitalsRepository, input: SetVitalsInput): Promise<VitalsRecord> {
  return repository.set(input);
}
