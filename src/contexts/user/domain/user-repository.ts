import type { User } from "./user";

export interface GetOrCreateUserInput {
  firebaseUid: string;
  email: string;
  displayName: string | null;
}

/**
 * Port for user persistence. `getOrCreate` implements get-or-create
 * semantics keyed by `firebaseUid`: if a row already exists it is returned
 * as-is (email/displayName are NOT refreshed from the input).
 */
export interface UserRepository {
  getOrCreate(input: GetOrCreateUserInput): Promise<User>;
  /** Sets the user's IANA timezone (validated by the caller before this is invoked). */
  updateTimezone(userId: string, timezone: string): Promise<void>;
  /** The user by internal id, or `null` if not found. */
  getById(userId: string): Promise<User | null>;
}
