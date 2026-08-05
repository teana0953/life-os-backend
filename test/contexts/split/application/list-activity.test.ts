import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ACTIVITY_LIMIT, MAX_ACTIVITY_LIMIT, listActivity } from "../../../../src/contexts/split/application/list-activity";
import { InvalidSplitInput } from "../../../../src/contexts/split/domain/errors";
import type { SplitActivity } from "../../../../src/contexts/split/domain/split-activity";
import type { ListActivityOptions } from "../../../../src/contexts/split/domain/split-activity-repository";

// Hex letters on purpose: an id of digits only is unchanged by `toUpperCase`,
// so the case-normalization test below would pass without any normalization.
const A = "aaaabbbb-1111-2222-3333-ccccddddeeee";

function entry(id: string, createdAt: string): SplitActivity & { audienceUserIds: string[] | null } {
  return {
    id,
    type: "expense_created",
    actorUserId: A,
    actorDisplayName: "Ann",
    groupId: null,
    groupName: null,
    subjectId: id,
    counterpartUserId: null,
    counterpartDisplayName: null,
    amount: 100,
    previousAmount: null,
    actorIsPayer: null,
    currency: "TWD",
    description: "Dinner",
    createdAt: new Date(createdAt),
    audienceUserIds: [A],
  };
}

/** Records what the use case asked for, so the clamping and the decoded cursor are observable. */
class RecordingRepository {
  calls: { userId: string; options: ListActivityOptions }[] = [];
  constructor(private readonly rows: SplitActivity[]) {}

  async listForUser(userId: string, options: ListActivityOptions): Promise<SplitActivity[]> {
    this.calls.push({ userId, options });
    return this.rows.slice(0, options.limit);
  }
}

describe("listActivity", () => {
  let repository: RecordingRepository;

  beforeEach(() => {
    repository = new RecordingRepository([entry("aaaaaaaa-0000-0000-0000-000000000001", "2026-04-01T10:00:00.000Z"), entry("aaaaaaaa-0000-0000-0000-000000000002", "2026-04-01T09:00:00.000Z")]);
  });

  it("asks for the default page size when none is given", async () => {
    await listActivity(repository, A);
    // The literal, not `DEFAULT_ACTIVITY_LIMIT`: comparing the constant to
    // itself passes whatever the constant becomes, including an unbounded one.
    expect(repository.calls[0]?.options.limit).toBe(50);
    expect(DEFAULT_ACTIVITY_LIMIT).toBeLessThanOrEqual(MAX_ACTIVITY_LIMIT);
  });

  it("caps an oversized limit rather than rejecting it", async () => {
    await listActivity(repository, A, { limit: 5000 });
    expect(repository.calls[0]?.options.limit).toBe(MAX_ACTIVITY_LIMIT);
  });

  it("rejects a limit that is not a positive integer", async () => {
    await expect(listActivity(repository, A, { limit: 0 })).rejects.toBeInstanceOf(InvalidSplitInput);
    await expect(listActivity(repository, A, { limit: 1.5 })).rejects.toBeInstanceOf(InvalidSplitInput);
  });

  it("lower-cases the caller id, like every other id in this context", async () => {
    await listActivity(repository, A.toUpperCase());
    expect(repository.calls[0]?.userId).toBe(A);
  });

  it("offers a cursor only when the page came back full", async () => {
    const full = await listActivity(repository, A, { limit: 2 });
    expect(full.nextCursor).toBe(`2026-04-01T09:00:00.000Z|aaaaaaaa-0000-0000-0000-000000000002`);

    const short = await listActivity(repository, A, { limit: 50 });
    expect(short.nextCursor).toBeNull();
  });

  it("decodes its own cursor back into the timestamp and id it encoded", async () => {
    const page = await listActivity(repository, A, { limit: 2 });
    await listActivity(repository, A, { limit: 2, cursor: page.nextCursor! });

    // The id is carried, not just the timestamp: entries written in one batch
    // share a timestamp, and a cursor without the id would skip or repeat them.
    expect(repository.calls[1]?.options.before).toEqual({
      createdAt: new Date("2026-04-01T09:00:00.000Z"),
      id: "aaaaaaaa-0000-0000-0000-000000000002",
    });
  });

  it("rejects a malformed cursor instead of silently starting from the top", async () => {
    await expect(listActivity(repository, A, { cursor: "not-a-cursor" })).rejects.toBeInstanceOf(InvalidSplitInput);
    await expect(listActivity(repository, A, { cursor: "not-a-date|abc" })).rejects.toBeInstanceOf(InvalidSplitInput);
    await expect(listActivity(repository, A, { cursor: "2026-04-01T09:00:00.000Z|" })).rejects.toBeInstanceOf(InvalidSplitInput);
    // The id half must be a uuid, not merely non-empty: the repository casts it
    // (`::uuid`) inside the keyset comparison, so anything else raises in
    // Postgres and surfaces as a 500 for what is a caller error.
    await expect(listActivity(repository, A, { cursor: "2026-04-01T09:00:00.000Z|not-a-uuid" })).rejects.toBeInstanceOf(InvalidSplitInput);
  });
});
