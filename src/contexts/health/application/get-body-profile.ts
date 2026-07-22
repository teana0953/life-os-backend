import type { BodyProfile } from "../domain/body-profile";
import type { BodyProfileRepository } from "../domain/body-profile-repository";

/**
 * Use case: the user's body profile. When none has been set, reports the default
 * with both values null (mirroring the "no record → default" pattern).
 */
export async function getBodyProfile(repository: BodyProfileRepository, userId: string): Promise<BodyProfile> {
  const profile = await repository.get(userId);
  return profile ?? { userId, heightCm: null, targetWeightKg: null };
}
