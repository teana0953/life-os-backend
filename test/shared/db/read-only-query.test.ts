import { describe, expect, it } from "vitest";
import { describeQueryShape, isRetryableReadOnlyBody } from "../../../src/shared/db/read-only-query";

// The bodies below are the wire format the neon HTTP driver actually POSTs:
// `{query, params}` for a single statement, `{queries:[...]}` for db.batch().
// The SQL strings marked "captured" were produced by running the real
// drizzle + neon stack against a fake fetch (see neon-integration.test.ts,
// which re-derives them from the live driver so they cannot drift).
const single = (query: unknown) => JSON.stringify({ query, params: [] });
const batch = (...queries: string[]) => JSON.stringify({ queries: queries.map((query) => ({ query, params: [] })) });

describe("isRetryableReadOnlyBody — accepts reads", () => {
  it("accepts a plain select", () => {
    expect(isRetryableReadOnlyBody(single("select 1"))).toBe(true);
  });

  it("accepts drizzle-captured select SQL", () => {
    expect(
      isRetryableReadOnlyBody(
        single(
          'select "id", "firebase_uid", "email", "display_name", "timezone", "is_admin", "created_at" from "users" where "users"."firebase_uid" = $1 limit $2',
        ),
      ),
    ).toBe(true);
  });

  // THE anti-silent-failure case. A naive substring test for "update" would
  // reject this, and then retries would never fire in production for any of
  // the read queries that touch a table with an updated_at column.
  it("accepts a read whose columns include updated_at", () => {
    expect(
      isRetryableReadOnlyBody(
        single('select "user_id", "height_cm", "target_weight_kg", "updated_at" from "body_profile" where "body_profile"."user_id" = $1'),
      ),
    ).toBe(true);
  });

  it("accepts a read ordered by updated_at", () => {
    expect(isRetryableReadOnlyBody(single('select "id" from "split_expense" order by "updated_at" desc'))).toBe(true);
  });

  // Same shape as updated_at, for the other blocked keywords.
  it("accepts reads mentioning deleted_at / inserted_by / merged_into_id", () => {
    expect(isRetryableReadOnlyBody(single('select "deleted_at", "inserted_by", "merged_into_id" from "t"'))).toBe(true);
  });

  it("accepts leading whitespace and newlines", () => {
    expect(isRetryableReadOnlyBody(single("\n\t  select 1"))).toBe(true);
  });

  it("accepts a leading line comment", () => {
    expect(isRetryableReadOnlyBody(single("-- a comment\nselect 1"))).toBe(true);
  });

  it("accepts a leading block comment", () => {
    expect(isRetryableReadOnlyBody(single("/* a comment */ select 1"))).toBe(true);
  });

  it("accepts repeated mixed leading comments", () => {
    expect(isRetryableReadOnlyBody(single("/* one */\n-- two\n  /* three */select 1"))).toBe(true);
  });

  it("accepts mixed case", () => {
    expect(isRetryableReadOnlyBody(single("SeLeCt 1"))).toBe(true);
  });

  // No stripping is involved — the keyword check is start-anchored and the
  // forbidden patterns are unanchored — but the accepted behaviour is pinned.
  it("accepts a trailing semicolon", () => {
    expect(isRetryableReadOnlyBody(single("select 1 ;  "))).toBe(true);
  });

  // Read-only CTEs are accepted. `with` used to be refused outright, and that
  // rejection was pinned by a test; the old test encoded the decision, not a
  // safety property, and the decision was wrong for the one endpoint this fix
  // was written for. Accepting `with` is not a weakened guard: nothing was
  // removed from FORBIDDEN, and Postgres cannot express a write inside a CTE
  // without saying insert/update/delete/merge, all four of which FORBIDDEN
  // still rejects anywhere in the statement (the two tests below prove it on
  // the repo's own write CTE).
  it("accepts a read-only CTE", () => {
    expect(isRetryableReadOnlyBody(single("with x as (select 1 as a) select * from x"))).toBe(true);
  });

  it("accepts a recursive read-only CTE", () => {
    expect(
      isRetryableReadOnlyBody(single("with recursive t(n) as (select 1 union all select n + 1 from t where n < 5) select n from t")),
    ).toBe(true);
  });

  // The real /api/split/balances SQL (drizzle-balance-repository.ts:101),
  // abridged in the middle but keeping every construct that could trip a
  // FORBIDDEN pattern. neon-integration.test.ts pins the unabridged body
  // straight off the live driver.
  it("accepts the real split-balance CTE", () => {
    expect(
      isRetryableReadOnlyBody(
        single(`
      WITH net AS (
        SELECT ss.user_id AS counterpart_id, se.currency AS currency, ss.amount AS signed_amount
          FROM split_share ss
          JOIN split_expense se ON se.id = ss.expense_id
         WHERE se.payer_user_id = $1::uuid AND ss.user_id != $1::uuid
        UNION ALL
        SELECT s.to_user_id AS counterpart_id, s.currency AS currency, s.amount AS signed_amount
          FROM split_settlement s
         WHERE s.from_user_id = $1::uuid
      )
      SELECT net.counterpart_id AS counterpart_id, u.display_name AS display_name, u.email AS email, net.currency AS currency, SUM(net.signed_amount) AS net
        FROM net
        JOIN users u ON u.id = net.counterpart_id
       GROUP BY net.counterpart_id, u.display_name, u.email, net.currency
      HAVING SUM(net.signed_amount) != 0
    `),
      ),
    ).toBe(true);
  });

  it("accepts a batch where every statement is a read", () => {
    expect(isRetryableReadOnlyBody(batch("select 1", '  -- c\nselect "updated_at" from "t"'))).toBe(true);
  });
});

describe("isRetryableReadOnlyBody — rejects writes and anything unrecognised", () => {
  it("rejects insert", () => {
    expect(
      isRetryableReadOnlyBody(single('insert into "users" ("id", "firebase_uid") values (default, $1)')),
    ).toBe(false);
  });

  it("rejects update", () => {
    expect(isRetryableReadOnlyBody(single('update "users" set "email" = $1 where "users"."id" = $2'))).toBe(false);
  });

  it("rejects delete", () => {
    expect(isRetryableReadOnlyBody(single('delete from "users" where "id" = $1'))).toBe(false);
  });

  it("rejects merge", () => {
    expect(isRetryableReadOnlyBody(single('merge into "t" using "s" on true when matched then do nothing'))).toBe(false);
  });

  it("rejects insert ... on conflict ... returning", () => {
    expect(
      isRetryableReadOnlyBody(single('insert into "t" ("a") values ($1) on conflict ("a") do update set "a" = $1 returning "a"')),
    ).toBe(false);
  });

  // A data-modifying CTE starts with `with`, not `insert`. Since `with` is an
  // accepted opening keyword, the FORBIDDEN scan is the ONLY thing standing
  // between these and a retried write — so each of the four writing keywords
  // Postgres allows in a CTE gets its own fixture. Two of the four spell a
  // second forbidden word unavoidably (`insert into`, `merge into`) and so are
  // held up by `\binto\b` as well; what makes `\binsert\b` and `\bmerge\b`
  // individually killable is the string-literal cases at the bottom of this
  // file. `update` and `delete` are isolated here.
  it("rejects an insert CTE", () => {
    expect(
      isRetryableReadOnlyBody(single('with x as (insert into "t" ("a") values ($1) returning "a") select * from x')),
    ).toBe(false);
  });

  // The friend-invite claim (drizzle-friend-invite-repository.ts:127) reduced
  // to its `update` leg. The full statement also says `insert into`, so it
  // cannot on its own show that `\bupdate\b` is doing any work; this can.
  it("rejects an update CTE whose only forbidden word is `update`", () => {
    expect(
      isRetryableReadOnlyBody(
        single(
          "WITH claimed AS (UPDATE friend_invite SET accepted_at = now() WHERE token_hash = $1 AND accepted_at IS NULL RETURNING inviter_user_id) SELECT inviter_user_id FROM claimed",
        ),
      ),
    ).toBe(false);
  });

  it("rejects a delete CTE", () => {
    expect(isRetryableReadOnlyBody(single('with x as (delete from "t" where "a" = $1 returning "a") select * from x'))).toBe(false);
  });

  it("rejects a merge CTE", () => {
    expect(
      isRetryableReadOnlyBody(
        single('with x as (merge into "t" using "s" on true when matched then do nothing returning "a") select * from x'),
      ),
    ).toBe(false);
  });

  // A CTE can also be read-only while the statement it feeds is the write.
  it("rejects a read-only CTE feeding a write statement", () => {
    expect(isRetryableReadOnlyBody(single('with x as (select 1 as a) update "t" set "b" = 1 from x'))).toBe(false);
  });

  it("rejects select ... for update", () => {
    expect(isRetryableReadOnlyBody(single('select "id" from "settlement" as s where s."id" = $1 for update of s'))).toBe(false);
  });

  it("rejects select ... for no key update", () => {
    expect(isRetryableReadOnlyBody(single('select "id" from "t" for no key update'))).toBe(false);
  });

  it("rejects select ... for share", () => {
    expect(isRetryableReadOnlyBody(single('select "id" from "t" for share'))).toBe(false);
  });

  it("rejects select ... for key share", () => {
    expect(isRetryableReadOnlyBody(single('select "id" from "t" for key share'))).toBe(false);
  });

  it("rejects a select calling a sequence-advancing function", () => {
    expect(isRetryableReadOnlyBody(single(`select nextval('s')`))).toBe(false);
    expect(isRetryableReadOnlyBody(single(`select setval('s', 1)`))).toBe(false);
  });

  it("rejects a select taking an advisory lock", () => {
    expect(isRetryableReadOnlyBody(single("select pg_advisory_lock(1)"))).toBe(false);
  });

  it("rejects select ... into", () => {
    expect(isRetryableReadOnlyBody(single('select "a" into "tmp" from "t"'))).toBe(false);
  });

  it("rejects a non-select first keyword", () => {
    expect(isRetryableReadOnlyBody(single('table "users"'))).toBe(false);
    expect(isRetryableReadOnlyBody(single("values (1)"))).toBe(false);
    expect(isRetryableReadOnlyBody(single("begin"))).toBe(false);
  });

  it("rejects `selective` — the keyword check is word-bounded on the accept side too", () => {
    expect(isRetryableReadOnlyBody(single("selectively 1"))).toBe(false);
  });

  it("rejects a batch mixing a read and a write", () => {
    expect(isRetryableReadOnlyBody(batch("select 1", 'update "t" set "a" = 1'))).toBe(false);
  });

  // `[].every(...)` is true. Without an explicit non-empty check this body
  // would be classified retryable on vacuous truth alone.
  it("rejects an empty queries array", () => {
    expect(isRetryableReadOnlyBody(JSON.stringify({ queries: [] }))).toBe(false);
  });

  it("rejects a body that is not valid JSON", () => {
    expect(isRetryableReadOnlyBody("not json")).toBe(false);
  });

  it("rejects a body with no query field", () => {
    expect(isRetryableReadOnlyBody(JSON.stringify({ params: [] }))).toBe(false);
  });

  it("rejects a non-string query", () => {
    expect(isRetryableReadOnlyBody(single(42))).toBe(false);
    expect(isRetryableReadOnlyBody(JSON.stringify({ queries: [{ query: 42 }] }))).toBe(false);
  });

  it("rejects a queries field that is not an array", () => {
    expect(isRetryableReadOnlyBody(JSON.stringify({ queries: { query: "select 1" } }))).toBe(false);
  });

  it("rejects a non-string body", () => {
    expect(isRetryableReadOnlyBody(undefined)).toBe(false);
    expect(isRetryableReadOnlyBody(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  // Documented conservative-wrong direction: the classifier is not a SQL
  // tokenizer, so a string literal containing a blocked word is refused.
  // A false negative just means the caller sees the 500 it would have seen.
  //
  // These cases are also what makes `\binsert\b` and `\bmerge\b` individually
  // killable. Outside a CTE those words can only be the FIRST keyword, where
  // the opening-keyword check rejects the statement before any forbidden
  // pattern runs; inside a CTE they are always followed by `into`, which
  // `\binto\b` catches on its own. Without the literals below, removing
  // `\binsert\b` or `\bmerge\b` leaves the whole suite green. (`\bdelete\b` is
  // separately killable via the delete-CTE case above — `delete from` names no
  // other forbidden word.)
  it.each([
    [`select 'insert' as a`],
    [`select 'delete' as a`],
    [`select 'merge' as a`],
  ])("rejects a read whose string literal contains a blocked word: %s (known false negative)", (query) => {
    expect(isRetryableReadOnlyBody(single(query))).toBe(false);
  });
});

describe("describeQueryShape — logging descriptor carries no SQL text", () => {
  it("describes a single statement", () => {
    expect(describeQueryShape(single('select "updated_at" from "t"'))).toBe("select x1");
  });

  it("describes a batch by first keyword and statement count", () => {
    expect(describeQueryShape(batch("select 1", 'update "t" set "a" = 1'))).toBe("batch select x2");
  });

  // `with` is now a retryable shape, so it is a keyword that will show up in
  // the Workers log — reported as itself, not folded into "select".
  it("describes a CTE by its own opening keyword", () => {
    expect(describeQueryShape(single("with net as (select 1 as a) select * from net"))).toBe("with x1");
  });

  it("describes an unparseable body without throwing", () => {
    expect(describeQueryShape("not json")).toBe("unparsed");
  });

  it("never contains table or column names", () => {
    const shape = describeQueryShape(single('select "secret_column" from "secret_table" where "x" = $1'));
    expect(shape).not.toContain("secret");
  });
});
