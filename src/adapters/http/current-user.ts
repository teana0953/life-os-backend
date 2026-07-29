import { getOrCreateUser } from "../../contexts/user/application/get-or-create-user";
import type { User } from "../../contexts/user/domain/user";
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

/**
 * Resolves the user for a verified Firebase identity (get-or-create still
 * runs, as with `resolveUserId`), returning `null` when the user is not an
 * administrator. `null` means forbidden — the handler maps it to `403`; an
 * unauthenticated/invalid token is already rejected as `401` upstream by
 * `authMiddleware`, before this ever runs.
 */
export async function resolveAdminUser(userRepository: UserRepository, claims: FirebaseClaims): Promise<User | null> {
  const user = await getOrCreateUser(userRepository, {
    firebaseUid: claims.uid,
    email: claims.email ?? "",
    displayName: claims.displayName,
  });
  return user.isAdmin ? user : null;
}
