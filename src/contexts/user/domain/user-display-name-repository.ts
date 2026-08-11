import type { User } from "./user";

/** Port for changing the authenticated user's persisted display name. */
export interface UserDisplayNameRepository {
  updateDisplayName(userId: string, displayName: string): Promise<User | null>;
}
