import type { Context } from "hono";
import { getOrCreateUser } from "../../../contexts/user/application/get-or-create-user";
import {
  InvalidDisplayNameError,
  updateDisplayName,
} from "../../../contexts/user/application/update-display-name";
import type { User } from "../../../contexts/user/domain/user";
import type { UserDisplayNameRepository } from "../../../contexts/user/domain/user-display-name-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireString } from "../validation";

export interface MeHandlerOptions {
  userRepository: UserRepository;
  userDisplayNameRepository: UserDisplayNameRepository;
}

function userToJson(user: User) {
  return {
    id: user.id,
    firebase_uid: user.firebaseUid,
    email: user.email,
    display_name: user.displayName,
    created_at: user.createdAt.toISOString(),
    is_admin: user.isAdmin,
  };
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

    return c.json(userToJson(user));
  };
}

/** Protected `PATCH /api/me`: persist the user's chosen display name. */
export function createUpdateMeHandler(options: MeHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const claims = c.get("firebaseClaims");
    const current = await getOrCreateUser(options.userRepository, {
      firebaseUid: claims.uid,
      email: claims.email ?? "",
      displayName: claims.displayName,
    });
    const body = await c.req.json<Record<string, unknown>>();
    try {
      const updated = await updateDisplayName(
        options.userDisplayNameRepository,
        current.id,
        requireString(body.display_name, "display_name"),
      );
      return c.json(userToJson(updated));
    } catch (error) {
      if (error instanceof InvalidDisplayNameError) {
        throw new BadRequestError("display_name must be 1-50 characters");
      }
      throw error;
    }
  };
}
