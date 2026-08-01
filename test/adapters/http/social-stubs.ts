import type { FriendInviteRepository } from "../../../src/contexts/social/domain/friend-invite-repository";
import type { FriendshipRepository } from "../../../src/contexts/social/domain/friendship-repository";

function notImplemented(): never {
  throw new Error("not implemented in this test's fakes");
}

/** Stubs for route tests that never touch the friends endpoints (see friends.test.ts for the real fakes). */
export const stubFriendshipRepository: FriendshipRepository = {
  listFriends: notImplemented,
  findFriend: notImplemented,
  delete: notImplemented,
};

export const stubFriendInviteRepository: FriendInviteRepository = {
  create: notImplemented,
  findByTokenHash: notImplemented,
  listUsableByInviter: notImplemented,
  revoke: notImplemented,
  claimForAccept: notImplemented,
};
