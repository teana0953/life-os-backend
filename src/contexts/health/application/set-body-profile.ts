import type { BodyProfile } from "../domain/body-profile";
import type { BodyProfileRepository, UpdateBodyProfilePatch } from "../domain/body-profile-repository";

/** Raised when a provided height or target weight is not a positive number. */
export class InvalidBodyProfileError extends Error {}

/**
 * Use case: partially upsert the user's body profile. Validates that any
 * provided `heightCm`/`targetWeightKg` is a positive number (throws otherwise),
 * then upserts — a patch with only one field leaves the other unchanged.
 */
export async function setBodyProfile(
  repository: BodyProfileRepository,
  userId: string,
  patch: UpdateBodyProfilePatch,
): Promise<BodyProfile> {
  if (patch.heightCm !== undefined && !(patch.heightCm > 0)) {
    throw new InvalidBodyProfileError("heightCm must be a positive number");
  }
  if (patch.targetWeightKg !== undefined && !(patch.targetWeightKg > 0)) {
    throw new InvalidBodyProfileError("targetWeightKg must be a positive number");
  }
  return repository.upsert(userId, patch);
}
