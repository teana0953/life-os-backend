import type { MenstrualPeriod } from "../domain/menstrual-period";
import type { AddPeriodInput, MenstrualRepository } from "../domain/menstrual-repository";

/** Raised when a period is invalid (end date earlier than start date). */
export class InvalidPeriodError extends Error {}

/**
 * Use case: add a menstrual period. Rejects an `endDate` (when present) that is
 * earlier than `startDate` before persisting.
 */
export async function addPeriod(repository: MenstrualRepository, input: AddPeriodInput): Promise<MenstrualPeriod> {
  if (input.endDate !== null && input.endDate < input.startDate) {
    throw new InvalidPeriodError("end_date must not be earlier than start_date");
  }
  return repository.add(input);
}
