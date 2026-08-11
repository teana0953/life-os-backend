import type { User } from "../domain/user";
import type { UserDisplayNameRepository } from "../domain/user-display-name-repository";

export const MAX_DISPLAY_NAME_LENGTH = 50;

export class InvalidDisplayNameError extends Error {}

/** Trims and persists the user's chosen name. */
export async function updateDisplayName(
  repository: UserDisplayNameRepository,
  userId: string,
  displayName: string,
): Promise<User> {
  const normalized = displayName.trim();
  if (normalized.length === 0 || normalized.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new InvalidDisplayNameError();
  }
  const user = await repository.updateDisplayName(userId, normalized);
  if (!user) throw new Error("user disappeared during display-name update");
  return user;
}
