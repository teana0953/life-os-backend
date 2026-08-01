import type { Context } from "hono";
import { acceptInvite } from "../../../contexts/social/application/accept-invite";
import { createInvite } from "../../../contexts/social/application/create-invite";
import { listFriends } from "../../../contexts/social/application/list-friends";
import { listMyInvites } from "../../../contexts/social/application/list-my-invites";
import { previewInvite } from "../../../contexts/social/application/preview-invite";
import { removeFriend } from "../../../contexts/social/application/remove-friend";
import { revokeInvite } from "../../../contexts/social/application/revoke-invite";
import {
  CannotFriendSelf,
  InviteAlreadyUsed,
  InviteExpired,
  InviteNotFound,
  InviteRevoked,
} from "../../../contexts/social/domain/errors";
import type { FriendInvite } from "../../../contexts/social/domain/friend-invite";
import type { FriendInviteRepository } from "../../../contexts/social/domain/friend-invite-repository";
import type { Friend } from "../../../contexts/social/domain/friend-user";
import type { FriendshipRepository } from "../../../contexts/social/domain/friendship-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { requireString } from "../validation";

export interface FriendsHandlerOptions {
  userRepository: UserRepository;
  friendshipRepository: FriendshipRepository;
  friendInviteRepository: FriendInviteRepository;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maps this context's typed errors to HTTP. A missing invite is a plain 404,
 * identical to another user's invite, so nothing reveals what exists. The
 * remaining failures are 400s with **distinct codes** — the spec requires
 * expired / already used / revoked to be told apart so the user can be given
 * the right explanation.
 */
function mapSocialError(err: unknown, c: Context): Response {
  if (err instanceof InviteNotFound) return c.json({ error: "not_found" }, 404);
  if (err instanceof InviteExpired) return c.json({ error: "invite_expired" }, 400);
  if (err instanceof InviteAlreadyUsed) return c.json({ error: "invite_already_used" }, 400);
  if (err instanceof InviteRevoked) return c.json({ error: "invite_revoked" }, 400);
  if (err instanceof CannotFriendSelf) return c.json({ error: "cannot_friend_self" }, 400);
  throw err;
}

/** `Friend` has no email field, so this cannot serialize one. */
function friendToJson(friend: Friend) {
  return { user_id: friend.userId, display_name: friend.displayName };
}

/** Deliberately omits `accepted_by_user_id` (and the token/hash) — the inviter has no use for them. */
function inviteToJson(invite: FriendInvite) {
  return { id: invite.id, expires_at: invite.expiresAt.toISOString(), created_at: invite.createdAt.toISOString() };
}

/**
 * Reads the invite token from the request **body**. It is a bearer credential:
 * in a URL path or query it would land in Workers access logs and `Referer`
 * headers, which is why both preview and accept are POSTs (design.md).
 */
async function tokenFromBody(c: Context): Promise<string> {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  return requireString(body.token, "token");
}

/** Protected `GET /api/friends`: the caller's friends, by name only. */
export function createListFriendsHandler(options: FriendsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const friends = await listFriends(options.friendshipRepository, userId);
    return c.json({ friends: friends.map(friendToJson) });
  };
}

/**
 * Protected `DELETE /api/friends/:friendUserId`: ends the friendship from
 * either side. "Not your friend", "no such user" and a malformed id all
 * answer 404, so none of them reveals whether the other party exists.
 */
export function createRemoveFriendHandler(options: FriendsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const friendUserId = c.req.param("friendUserId") ?? "";
    if (!UUID_RE.test(friendUserId)) return c.json({ error: "not_found" }, 404);

    const removed = await removeFriend(options.friendshipRepository, userId, friendUserId);
    if (!removed) return c.json({ error: "not_found" }, 404);
    return c.json({ deleted: true });
  };
}

/** Protected `POST /api/friends/invites`: mints an invite; the plaintext token is returned here and nowhere else. */
export function createCreateInviteHandler(options: FriendsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const { token, invite } = await createInvite(options.friendInviteRepository, userId);
    return c.json({ token, expires_at: invite.expiresAt.toISOString() });
  };
}

/** Protected `GET /api/friends/invites`: the caller's own still-usable invites. */
export function createListMyInvitesHandler(options: FriendsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const invites = await listMyInvites(options.friendInviteRepository, userId);
    return c.json({ invites: invites.map(inviteToJson) });
  };
}

/** Protected `DELETE /api/friends/invites/:id`: revokes one of the caller's own invites; anyone else's is a 404. */
export function createRevokeInviteHandler(options: FriendsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const id = c.req.param("id") ?? "";
    if (!UUID_RE.test(id)) return c.json({ error: "not_found" }, 404);

    try {
      await revokeInvite(options.friendInviteRepository, userId, id);
      return c.json({ revoked: true });
    } catch (err) {
      return mapSocialError(err, c);
    }
  };
}

/**
 * Protected `POST /api/friends/invites/preview`: who is behind a link, before
 * accepting. Requires a signed-in caller so tokens cannot be swept
 * anonymously, and the token travels in the body.
 */
export function createPreviewInviteHandler(options: FriendsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const token = await tokenFromBody(c);

    try {
      const preview = await previewInvite(
        { friendships: options.friendshipRepository, invites: options.friendInviteRepository },
        { userId, token },
      );
      return c.json({ inviter_display_name: preview.inviterDisplayName, already_friends: preview.alreadyFriends });
    } catch (err) {
      return mapSocialError(err, c);
    }
  };
}

/** Protected `POST /api/friends/invites/accept`: consumes the invite and creates the friendship. Token in the body. */
export function createAcceptInviteHandler(options: FriendsHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const token = await tokenFromBody(c);

    try {
      const result = await acceptInvite(
        { friendships: options.friendshipRepository, invites: options.friendInviteRepository },
        { acceptingUserId: userId, token },
      );
      return c.json({ friend: friendToJson(result.friend), already_friends: result.alreadyFriends });
    } catch (err) {
      return mapSocialError(err, c);
    }
  };
}
