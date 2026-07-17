import type { Context } from "hono";
import { getOrCreateUser } from "../../../contexts/user/application/get-or-create-user";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import type { AuthVariables } from "../middleware/auth";

export interface MeHandlerOptions {
  userRepository: UserRepository;
}

/** Protected `GET /api/me`: get-or-create the user for the verified identity and return its profile. */
export function createMeHandler(options: MeHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const claims = c.get("firebaseClaims");

    const user = await getOrCreateUser(options.userRepository, {
      firebaseUid: claims.uid,
      email: claims.email ?? "",
      displayName: claims.displayName,
    });

    return c.json({
      id: user.id,
      firebase_uid: user.firebaseUid,
      email: user.email,
      display_name: user.displayName,
      created_at: user.createdAt.toISOString(),
    });
  };
}
