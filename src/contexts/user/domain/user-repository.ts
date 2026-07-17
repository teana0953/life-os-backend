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
}
