## 1. Schema and migration

- [x] 1.1 In `src/shared/db/schema.ts`, add `itemTitle` (`text`, not null), `itemCategory`
      (`text`, not null — plain text like `careItem.category`, NOT a Postgres enum; the constrained
      set is the domain-layer `CareCategory` union) and `itemDose` (`text`, nullable) to `careLog`,
      with a doc
      comment stating these are a write-time snapshot that is deliberately never re-synced on
      rename (design D1) — verify `npm run typecheck` passes.
- [x] 1.2 In the same table, make `careItemId` / `careScheduleId` nullable and change both
      `references(...)` to `{ onDelete: "set null" }`; leave `careOccurrence`'s foreign keys on
      cascade and note why in a comment (design D6) — verify `npm run typecheck` passes.
- [x] 1.3 Run `npm run db:generate`, then READ the generated `drizzle/00XX_*.sql` and hand-add the
      backfill `UPDATE care_log SET item_title = ci.title, item_category = ci.category,
      item_dose = ci.dose FROM care_item ci WHERE ci.id = care_log.care_item_id;` between the
      `ADD COLUMN` statements and the `SET NOT NULL` statements — verify by reading the final file
      that the order is add-nullable → backfill → set-not-null → drop-not-null on the ids → drop
      and recreate both foreign keys as `ON DELETE SET NULL`.
- [x] 1.4 Add a DB-level test in `test/db/` that inserts a care item, schedule and log, deletes the
      item, and asserts the `care_log` row still exists with `care_item_id` and `care_schedule_id`
      null and its snapshot columns intact — verify it fails against the old schema and passes
      against the new one.
- [x] 1.5 In the same file, add a case seeding TWO items with schedules at the SAME `local_date` and
      `time_of_day`, answering both, then deleting both items: both deletes must succeed and both
      logs must survive with a null `care_schedule_id`. This is the only shape that detects the
      unique key being tightened to `NULLS NOT DISTINCT` (which would make the second delete abort,
      leaving a reminder the user cannot delete) — a fixture with one NULL-bearing row cannot —
      verify by appending that `ALTER TABLE ... UNIQUE NULLS NOT DISTINCT` to the migration and
      confirming this case, specifically, goes red.
- [x] 1.6 Add `test/db/care-log-snapshot-backfill.test.ts`, which does NOT use `harness.ts`: it
      creates its own PGlite, applies migrations 0000–0035 in `_journal.json` order (splitting each
      file on `--> statement-breakpoint`), inserts two pre-change `care_log` rows pointing at
      different items (one with a `dose`, one without), then applies 0036 and asserts each row
      carries its own item's `title`/`category`/`dose`, that neither holds the deploy-window
      `''`/`'custom'`, and that both `SET NOT NULL`s landed. `harness.ts` migrates an empty database
      in one pass, so the backfill `UPDATE` and the `SET NOT NULL` are unreachable there — verify by
      deleting the backfill `UPDATE` line from 0036 and confirming this file goes red
      (`column "item_title" of relation "care_log" contains null values`).

## 2. Domain and repository

- [x] 2.1 In `src/contexts/notifications/domain/care-log.ts`, widen `CareLog.careItemId` /
      `careScheduleId` to `string | null`, add `itemTitle` / `itemCategory` / `itemDose`, and add
      the same three (required, non-null ids) to `CreateCareLogInput` — verify `npm run typecheck`
      reports errors only at the call sites tasks 3.x will fix.
- [x] 2.2 In `src/contexts/notifications/adapters/drizzle-care-log-repository.ts`, map the new
      columns in `toDomain` and write them in both `upsertIfAbsent` and `upsert`; leave `upsert`'s
      `onConflictDoUpdate` `set` clause alone so an edit does not restamp the snapshot of an
      existing record — verify `test/contexts/notifications/adapters/drizzle-care-log-repository.test.ts`
      passes with new cases covering both write paths and the untouched-snapshot-on-edit rule.

## 3. Write paths snapshot the item

- [x] 3.1 In `answer-care-slot.ts`, pass `itemTitle`/`itemCategory`/`itemDose` from the item already
      fetched via `getByScheduleId` — verify a new case in
      `test/contexts/notifications/application/answer-care-slot.test.ts` asserts the written log
      carries them.
- [x] 3.2 Same in `edit-care-slot.ts` — verify the equivalent case in `edit-care-slot.test.ts`.
- [x] 3.3 Same in `run-care-day.ts`'s `markMissedForUserDay` (the item is already in
      `enabledSchedules`) — verify a case in `run-care-day.test.ts` asserts a missed log carries the
      snapshot.
- [x] 3.4 Add a test asserting `answerCareSlot` and `editCareSlot` still return `null` (404) for a
      schedule whose item was deleted, so no record can be written for a deleted item (design D7,
      spec "A deleted item stops producing new work").

## 4. History read path

- [x] 4.1 In `get-care-today.ts`, add `itemDeleted: boolean` to `CareTodaySlot` and widen its
      `careItemId` / `careScheduleId` to `string | null`; `getCareToday` always emits non-null ids
      and `itemDeleted: false` — verify `get-care-today.test.ts` passes with an assertion on the new
      field.
- [x] 4.2 In `get-care-range.ts`, track the id of every log consumed by an expanded slot, then emit
      one slot per unconsumed log on its own `localDate` using the log's stored status, time,
      completion time and dose quantity (design D3) — verify new cases in `get-care-range.test.ts`
      cover a deleted item's log, a disabled schedule's log, and a schedule inactive on the log's
      date.
- [x] 4.3 In the same function, resolve an unconsumed log's title/category/dose from the live item
      when its `careItemId` matches one of the already-fetched items (`itemDeleted: false`) and from
      the snapshot otherwise (`itemDeleted: true`) (design D4) — verify tests cover both branches,
      including a renamed live item whose lapsed schedule's record shows the NEW title while a
      deleted item's record shows the OLD one.
- [x] 4.4 Verify with a test that a log matched by a live slot is emitted exactly once (no
      duplicate from the unconsumed pass) and that unconsumed slots interleave by `timeOfDay` then
      `title` rather than being appended after the live ones.
- [x] 4.5 Verify `getCareRange` still issues exactly two repository reads regardless of how many
      orphaned logs the range contains — a counting fake in `get-care-range.test.ts`.

## 5. API surface

- [x] 5.1 In `src/adapters/http/routes/care.ts`, emit `item_deleted` from `careTodaySlotToJson` and
      allow null `care_item_id` / `care_schedule_id` — verify `test/adapters/http/care.test.ts`
      asserts the new field on both `/api/care/today` and `/api/care/range`.
- [x] 5.2 Add an end-to-end case in `test/adapters/http/care.test.ts`: record a slot, delete the
      item, then assert `/api/care/range` returns the record flagged `item_deleted: true` with its
      snapshot title while `/api/care/today` no longer lists it.
- [x] 5.3 In `src/contexts/assistant/application/tools.ts`, add `item_deleted` to the `careSlot`
      mapper so the assistant cannot present a deleted item's record as something still tracked —
      verify the assistant tools test asserts it.
- [x] 5.4 Confirm `/api/health/overview`'s `care_range` section carries the same shape (it reuses
      `careRangeToJson`) — verify with an assertion in the health-overview test.

## 6. Verification

- [x] 6.1 Run `npm run typecheck` and `npm test` — all green; re-run the `db` project on its own with
      `npx vitest run --project db --no-file-parallelism` (parallel PGlite startups hook-timeout).
      Deliberately NOT `npm run lint:comments`: that script is the comment-sweep diff guard and
      fails on any non-comment diff, so it says nothing about this change.
- [x] 6.2 Mutation-check the guards that most easily go green for the wrong reason: revert the
      unconsumed-log emission in `get-care-range.ts` and revert the `SET NULL` foreign key in the
      migration, and confirm 4.2/4.3 and 1.4 respectively go red; plus the three from 1.1/1.5/1.6 —
      appending `UNIQUE NULLS NOT DISTINCT` to 0036 (1.5 red), deleting 0036's backfill `UPDATE`
      (1.6 red), and deleting `itemTitle` from the repository's inserts (`npx tsc --noEmit` exits 1
      with `TS2769` at both insert sites, which is the ONLY guard that every new writer fills the
      snapshot — it exists precisely because `schema.ts` withholds the two `DEFAULT`s the migration
      sets).
- [x] 6.2a Confirm the D3 `missed`/`done` pair guard does not depend on sort stability: the two rows
      tie on both comparator keys (`timeOfDay`, then `title` — D4 names both from the one live item),
      so it compares the pair as a set, and stays red when a live slot swallows the orphan.
- [x] 6.3 Update `openspec/specs/care-reminders/spec.md` via `openspec archive` at merge time; file
      the companion life-os frontend issue for rendering `item_deleted` records and tolerating null
      `care_item_id` / `care_schedule_id`. Frontend issue: teana0953/life-os#243.
