import { beforeEach, describe, expect, it } from "vitest";
import { addGroupMember } from "../../../../src/contexts/split/application/add-group-member";
import { archiveGroup } from "../../../../src/contexts/split/application/archive-group";
import { createGroup } from "../../../../src/contexts/split/application/create-group";
import { getGroup } from "../../../../src/contexts/split/application/get-group";
import { listMyGroups } from "../../../../src/contexts/split/application/list-my-groups";
import { AlreadyAGroupMember, GroupArchived, GroupNotFound, NotFriends } from "../../../../src/contexts/split/domain/errors";
import { InMemoryExpenseGroupRepository, InMemoryFriendChecker } from "../fakes";

const NOW = new Date("2026-08-01T00:00:00.000Z");
const A = "user-a";
const B = "user-b";
const C = "user-c";
const D = "user-d";

let groups: InMemoryExpenseGroupRepository;
let friends: InMemoryFriendChecker;

beforeEach(() => {
  groups = new InMemoryExpenseGroupRepository();
  friends = new InMemoryFriendChecker();
  friends.addFriendship(A, B);
  friends.addFriendship(A, C);
});

describe("createGroup", () => {
  it("makes the creator a member", async () => {
    const group = await createGroup(groups, "Trip", A);

    const members = await groups.listMembers(group.id);
    expect(members.map((m) => m.userId)).toEqual([A]);
  });
});

describe("listMyGroups", () => {
  it("lists only groups the caller is a member of", async () => {
    const mine = await createGroup(groups, "Mine", A);
    await createGroup(groups, "Not mine", B);

    const listed = await listMyGroups(groups, A);

    expect(listed.map((entry) => entry.group.id)).toEqual([mine.id]);
  });

  it("carries each group's members, so a listing can name every participant", async () => {
    // A grouped expense's participants are always members of its group, so
    // these names cover every grouped row the caller can see. Without them the
    // only endpoint returning names is `balances`, which omits anyone netting
    // to zero — a settled member would render as a bare uuid.
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);

    const listed = await listMyGroups(groups, A);

    expect(listed).toHaveLength(1);
    expect(listed[0].members.map((m) => m.userId).sort()).toEqual([A, B].sort());
  });

  it("resolves members for every group in one lookup, not one per group", async () => {
    // One round trip plus one, not one per group — the listing screen would
    // otherwise fan out across however many groups the user belongs to.
    await createGroup(groups, "One", A);
    await createGroup(groups, "Two", A);
    let calls = 0;
    const counting = {
      ...groups,
      listForUser: groups.listForUser.bind(groups),
      listMembersForGroups: async (ids: string[]) => {
        calls += 1;
        return groups.listMembersForGroups(ids);
      },
    } as typeof groups;

    await listMyGroups(counting, A);

    expect(calls).toBe(1);
  });
});

describe("getGroup", () => {
  it("returns the group and its members for a member", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);

    const details = await getGroup(groups, B, group.id);

    expect(details.group.id).toBe(group.id);
    expect(details.members.map((m) => m.userId).sort()).toEqual([A, B].sort());
  });

  it("hides the group from a non-member", async () => {
    const group = await createGroup(groups, "Trip", A);

    await expect(getGroup(groups, C, group.id)).rejects.toBeInstanceOf(GroupNotFound);
  });

  it("reports an unknown group id the same way as a hidden one", async () => {
    await expect(getGroup(groups, A, "no-such-group")).rejects.toBeInstanceOf(GroupNotFound);
  });
});

describe("addGroupMember", () => {
  it("lets a member add their own friend", async () => {
    const group = await createGroup(groups, "Trip", A);

    const member = await addGroupMember({ groups, friends }, A, group.id, B, NOW);

    expect(member.userId).toBe(B);
    expect((await groups.listMembers(group.id)).map((m) => m.userId)).toContain(B);
  });

  it("refuses to add someone who is already a member, instead of letting the unique constraint 500", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);

    await expect(addGroupMember({ groups, friends }, A, group.id, B, NOW)).rejects.toBeInstanceOf(AlreadyAGroupMember);
    expect((await groups.listMembers(group.id)).filter((m) => m.userId === B)).toHaveLength(1);
  });

  it("refuses to add a stranger", async () => {
    const group = await createGroup(groups, "Trip", A);

    await expect(addGroupMember({ groups, friends }, A, group.id, D, NOW)).rejects.toBeInstanceOf(NotFriends);
    expect(await groups.listMembers(group.id)).toHaveLength(1);
  });

  it("refuses a caller who is not a member", async () => {
    const group = await createGroup(groups, "Trip", A);

    await expect(addGroupMember({ groups, friends }, C, group.id, B, NOW)).rejects.toBeInstanceOf(GroupNotFound);
  });

  it("refuses to add anyone once the group is archived", async () => {
    const group = await createGroup(groups, "Trip", A);
    await archiveGroup(groups, A, group.id, NOW);

    await expect(addGroupMember({ groups, friends }, A, group.id, B, NOW)).rejects.toBeInstanceOf(GroupArchived);
  });
});

describe("archiveGroup", () => {
  it("lets the creator archive the group", async () => {
    const group = await createGroup(groups, "Trip", A);

    await archiveGroup(groups, A, group.id, NOW);

    expect((await groups.findById(group.id))?.archivedAt).toEqual(NOW);
  });

  it("succeeds on an already-archived group, keeping the first archiving's instant", async () => {
    // A double-tapped archive button. The group exists and ends up archived,
    // so a `GroupNotFound` here would be a second untruth on top of the
    // duplicate timeline entry the repository now refuses to write. That the
    // second call *records* nothing is proven against a real Postgres in
    // `test/db/split-activity-write.test.ts` — the fake cannot show it.
    const group = await createGroup(groups, "Trip", A);
    await archiveGroup(groups, A, group.id, NOW);

    await expect(archiveGroup(groups, A, group.id, new Date("2026-04-02T10:00:00.000Z"))).resolves.toBeUndefined();
    expect((await groups.findById(group.id))?.archivedAt).toEqual(NOW);
  });

  it("refuses a member who is not the creator, and leaves the group unchanged", async () => {
    const group = await createGroup(groups, "Trip", A);
    await addGroupMember({ groups, friends }, A, group.id, B, NOW);

    await expect(archiveGroup(groups, B, group.id, NOW)).rejects.toBeInstanceOf(GroupNotFound);
    expect((await groups.findById(group.id))?.archivedAt).toBeNull();
  });
});
