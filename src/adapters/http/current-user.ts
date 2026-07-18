import { getOrCreateUser } from "../../contexts/user/application/get-or-create-user";
import type { UserRepository } from "../../contexts/user/domain/user-repository";
import type { FirebaseClaims } from "../../shared/auth/firebase-verifier";

/** Resolves the internal user id for a verified Firebase identity (get-or-create). */
export async function resolveUserId(userRepository: UserRepository, claims: FirebaseClaims): Promise<string> {
  const user = await getOrCreateUser(userRepository, {
    firebaseUid: claims.uid,
    email: claims.email ?? "",
    displayName: claims.displayName,
  });
  return user.id;
}
