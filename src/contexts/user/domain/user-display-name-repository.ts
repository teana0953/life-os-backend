import type { User } from "./user";

export interface UserDisplayNameRepository {
  updateDisplayName(userId: string, displayName: string): Promise<User | null>;
}
