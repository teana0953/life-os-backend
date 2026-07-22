import type { BodyProfile } from "./body-profile";

/**
 * Partial-update patch: only the fields present on the patch are applied; an
 * absent field leaves the current value unchanged. Both are positive numbers
 * when present (validated by the caller).
 */
export interface UpdateBodyProfilePatch {
  heightCm?: number;
  targetWeightKg?: number;
}

export interface BodyProfileRepository {
  /** The user's body profile, or null when never set. */
  get(userId: string): Promise<BodyProfile | null>;
  /**
   * Upserts (keyed by userId), applying only the patch's present fields; an
   * empty patch is a no-op returning the current profile (or a null-valued
   * default when none exists).
   */
  upsert(userId: string, patch: UpdateBodyProfilePatch): Promise<BodyProfile>;
}
