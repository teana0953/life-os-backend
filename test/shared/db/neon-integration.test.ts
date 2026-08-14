import { neon, neonConfig } from "@neondatabase/serverless";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrizzleFriendInviteRepository } from "../../../src/contexts/social/adapters/drizzle-friend-invite-repository";
import { DrizzleBalanceRepository } from "../../../src/contexts/split/adapters/drizzle-balance-repository";
import { isRetryableReadOnlyBody } from "../../../src/shared/db/read-only-query";
import { createRetryingFetch } from "../../../src/shared/db/retry-fetch";
import * as schema from "../../../src/shared/db/schema";

// This suite drives the REAL neon() driver and the REAL drizzle query builder,
// faking only `fetch`. That is the point: the neon driver parses the response
// itself (`{fields:[{name,dataTypeID}], rows:[[raw text]]}`, array mode + raw
// text output) and throws on anything else, so a fake that lies about the wire
// format cannot pass. Hand-written SQL fixtures are likewise avoided — the
// classifier here is fed the bodies drizzle actually emitted.

const DATABASE_URL = "postgresql://user:pass@ep-fake-1.us-east-2.aws.neon.tech/lifeos";

/**
 * A faithful neon success payload for a single statement.
 *
 * Faithfulness was measured by corrupting it. Rows as objects instead of
 * raw-text arrays, and a missing `fields`, both redden this suite. On
 * dataTypeID the honest result is split, and an earlier note here got the
 * reason wrong ("drizzle re-parses positionally, so dataTypeID is not
 * load-bearing"): positional parsing only explains why the field *names* do
 * not matter. Corrupting `created_at` 1184 -> 25 does survive, because
 * drizzle's PgTimestamp runs `new Date(...)` over whatever string it is
 * handed; but corrupting `is_admin` 16 -> 25 reddens, because neon picks the
 * pg type parser by dataTypeID and only then does 't' become `true`. So
 * dataTypeID IS load-bearing for non-timestamp columns — the assertions below
 * are what hold it.
 */
const usersPayload = (rows: string[][]) => ({
  fields: [
    { name: "id", dataTypeID: 2950 }, // uuid
    { name: "firebase_uid", dataTypeID: 25 }, // text
    { name: "email", dataTypeID: 25 },
    { name: "display_name", dataTypeID: 25 },
    { name: "timezone", dataTypeID: 25 },
    { name: "is_admin", dataTypeID: 16 }, // bool
    { name: "created_at", dataTypeID: 1184 }, // timestamptz
  ],
  rows,
});

const USER_ROW = [
  "11111111-1111-1111-1111-111111111111",
  "firebase-abc",
  "a@b.c",
  null as unknown as string,
  "Asia/Taipei",
  "t",
  "2026-08-14 04:35:03.266+00",
];

const transient520 = () => new Response("error code: 520", { status: 520 });

type Harness = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  bodies: string[];
  setOutcomes: (outcomes: Array<Response | Error>) => void;
};

function harness(): Harness {
  const bodies: string[] = [];
  let outcomes: Array<Response | Error> = [];
  let index = 0;
  const fetchImpl = async (_url: string, init: RequestInit) => {
    bodies.push(init.body as string);
    const outcome = outcomes[index++];
    if (outcome === undefined) throw new Error(`unexpected fetch attempt #${index}`);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  neonConfig.fetchFunction = createRetryingFetch({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    random: () => 0.5,
  });
  const db = drizzle(neon(DATABASE_URL), { schema });
  return {
    db,
    bodies,
    setOutcomes: (next) => {
      outcomes = next;
      index = 0;
    },
  };
}

/**
 * drizzle wraps driver failures in `Failed query: ...` and hangs the driver's
 * own error off `.cause`. Asserting on the cause is what proves the message
 * came out of the neon driver reading the response body we returned.
 */
async function causeOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error) return cause;
    return error as Error;
  }
  throw new Error("expected the query to reject, but it resolved");
}

const originalFetchFunction = neonConfig.fetchFunction;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  neonConfig.fetchFunction = originalFetchFunction;
  vi.restoreAllMocks();
});

describe("neon + drizzle through the retrying fetch", () => {
  it("a select survives one 520 and returns correctly typed rows", async () => {
    const h = harness();
    h.setOutcomes([transient520(), new Response(JSON.stringify(usersPayload([USER_ROW])), { status: 200 })]);

    const rows = await h.db.select().from(schema.users).where(eq(schema.users.firebaseUid, "firebase-abc")).limit(1);

    expect(h.bodies).toHaveLength(2);
    expect(rows).toHaveLength(1);
    // These assertions are what make the fake load-bearing: the values below
    // only appear if the real neon parser accepted the payload's shape and ran
    // the pg type parsers keyed by dataTypeID.
    expect(rows[0].firebaseUid).toBe("firebase-abc");
    expect(rows[0].displayName).toBeNull();
    expect(rows[0].isAdmin).toBe(true);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0].createdAt.toISOString()).toBe("2026-08-14T04:35:03.266Z");
  });

  it("a select survives three 520s and still returns rows", async () => {
    const h = harness();
    h.setOutcomes([
      transient520(),
      transient520(),
      transient520(),
      new Response(JSON.stringify(usersPayload([USER_ROW])), { status: 200 }),
    ]);

    const rows = await h.db.select().from(schema.users);

    expect(h.bodies).toHaveLength(4);
    expect(rows[0].email).toBe("a@b.c");
  });

  it("an insert is NOT retried and surfaces neon's 520 error after one attempt", async () => {
    const h = harness();
    h.setOutcomes([transient520()]);

    const cause = await causeOf(h.db.insert(schema.users).values({ firebaseUid: "u", email: "e@x.com" }));
    expect(cause.message).toMatch(/Server error \(HTTP status 520\)/);
    expect(h.bodies).toHaveLength(1);
  });

  it("a read that exhausts its retries surfaces neon's error, meaning the final body was still readable", async () => {
    const h = harness();
    h.setOutcomes([transient520(), transient520(), transient520(), transient520()]);

    const cause = await causeOf(h.db.select().from(schema.users));
    expect(cause.message).toBe("Server error (HTTP status 520): error code: 520");
    expect(h.bodies).toHaveLength(4);
  });

  it("a 400 from neon is surfaced as a NeonDbError without retrying", async () => {
    const h = harness();
    h.setOutcomes([
      new Response(JSON.stringify({ message: 'relation "users" does not exist', code: "42P01" }), { status: 400 }),
    ]);

    const cause = await causeOf(h.db.select().from(schema.users));
    expect(cause.message).toBe('relation "users" does not exist');
    expect((cause as { code?: string }).code).toBe("42P01");
    expect(h.bodies).toHaveLength(1);
  });
});

describe("classifier fixtures captured from the live driver", () => {
  it("classifies the bodies drizzle actually emits", async () => {
    const h = harness();
    const emptyUsers = () => new Response(JSON.stringify(usersPayload([])), { status: 200 });
    const emptyBatch = () =>
      new Response(JSON.stringify({ results: [usersPayload([]), { fields: [], rows: [] }] }), { status: 200 });
    h.setOutcomes([emptyUsers(), emptyUsers(), emptyUsers(), emptyUsers(), emptyBatch()]);

    await h.db.select().from(schema.users).where(eq(schema.users.firebaseUid, "x")).limit(1);
    // body_profile is the real table whose read includes an `updated_at`
    // column — the case a naive substring check would silently reject.
    await h.db.select().from(schema.bodyProfile).where(eq(schema.bodyProfile.userId, "u"));
    await h.db.insert(schema.users).values({ firebaseUid: "u", email: "e@x.com" });
    await h.db.execute(sql`select 1`);
    await h.db.batch([
      h.db.select().from(schema.users),
      h.db.update(schema.users).set({ email: "z@x.com" }).where(eq(schema.users.firebaseUid, "u")),
    ]);

    const [selectUsers, selectBodyProfile, insertUser, rawSelect, mixedBatch] = h.bodies;

    // Wire shapes, pinned: single statements are {query, params}, batches are
    // {queries: [...]}. If the driver ever changes this the classifier stops
    // recognising anything, so it is asserted rather than assumed.
    expect(JSON.parse(selectUsers)).toMatchObject({ query: expect.any(String), params: expect.any(Array) });
    expect(JSON.parse(mixedBatch).queries).toHaveLength(2);

    expect(selectBodyProfile).toContain("updated_at");
    expect(isRetryableReadOnlyBody(selectBodyProfile)).toBe(true);
    expect(isRetryableReadOnlyBody(selectUsers)).toBe(true);
    expect(isRetryableReadOnlyBody(rawSelect)).toBe(true);
    expect(isRetryableReadOnlyBody(insertUser)).toBe(false);
    expect(isRetryableReadOnlyBody(mixedBatch)).toBe(false);
  });

  // The three CTEs this repo actually issues, driven through the real
  // repository classes so the fixtures cannot drift from the SQL that ships.
  // `/api/split/balances` is one of the endpoints that 500'd in both
  // 2026-08-14 incidents, so "is the balance CTE retryable" is the question
  // this whole classifier exists to answer correctly.
  it("classifies the repo's real CTEs: balance reads retryable, the invite claim not", async () => {
    const h = harness();
    const empty = () => new Response(JSON.stringify({ fields: [], rows: [] }), { status: 200 });
    h.setOutcomes([empty(), empty(), empty(), empty()]);

    const balances = new DrizzleBalanceRepository(() => h.db);
    await balances.balancesForUser("11111111-1111-1111-1111-111111111111", "2026-08-14");
    await balances.balancesForGroup("22222222-2222-2222-2222-222222222222");
    await new DrizzleFriendInviteRepository(() => h.db).claimForAccept({
      tokenHash: "hash",
      acceptingUserId: "33333333-3333-3333-3333-333333333333",
    });

    // balancesForUser issues the `with net as (...)` balance query first, then
    // a second schedule-progress read; index 0 is the CTE.
    const [personalBalance, , groupBalance, inviteClaim] = h.bodies;

    // Assert the captured bodies really are the CTEs, so a refactor that turns
    // one into a plain select cannot leave this test passing on nothing.
    expect(JSON.parse(personalBalance).query.trimStart().toLowerCase()).toMatch(/^with\b/);
    expect(JSON.parse(groupBalance).query.trimStart().toLowerCase()).toMatch(/^with\b/);
    expect(JSON.parse(inviteClaim).query.trimStart().toLowerCase()).toMatch(/^with\b/);

    expect(isRetryableReadOnlyBody(personalBalance)).toBe(true);
    expect(isRetryableReadOnlyBody(groupBalance)).toBe(true);
    // Measured, so it is not claimed as more than it is: the two `true`s die to
    // a single mutation (narrowing the opening keyword back to `^select`). The
    // `false` does not — the invite claim says `update`, `insert` AND `into`,
    // so all three rules must go before it flips, and each of those rules is
    // held individually by read-only-query.test.ts. What this line is actually
    // for is drift: it is the only check that would redden if `claimForAccept`
    // were rewritten into a shape that names none of them.
    expect(isRetryableReadOnlyBody(inviteClaim)).toBe(false);
  });
});
