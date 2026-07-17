import type { User } from "../domain/user";
import type { GetOrCreateUserInput, UserRepository } from "../domain/user-repository";

/**
 * Use case: get-or-create the user for an authenticated identity.
 * Delegates to the injected UserRepository port, which owns the
 * get-or-create semantics (no duplicate row, no refresh on return).
 */
export async function getOrCreateUser(
  repository: UserRepository,
  input: GetOrCreateUserInput,
): Promise<User> {
  return repository.getOrCreate(input);
}
