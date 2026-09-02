## Context

See proposal.md — Why. Two facts shape the approach:

- `care_log` is keyed by `(care_schedule_id, local_date, time_of_day)` (unique), and both
  `care_item_id` and `care_schedule_id` are `NOT NULL` with `ON DELETE CASCADE`. It stores the
  *outcome* (status, done_time, dose_quantity) but nothing that names *what* was taken — title,
  category and dose all live on `care_item`.
- `getCareRange` and `getCareToday` both build their output by iterating live schedules and
  looking up a log per slot. A log is only ever a decoration on a slot the schedule produced; a
  log with no such slot is unreachable by construction, independent of the foreign key.

Fixing only the foreign key would keep the rows and still show nothing. Fixing only the read path
would have nothing left to read. Both layers change here.

## Goals / Non-Goals

**Goals:**

- A `care_log` row is readable and nameable on its own, with no join to `care_item` required.
- `getCareRange` returns every log in the range, exactly once, without extra database round trips.
- Deleting a care item stays a real `DELETE` — no soft-delete flag threaded through every query.

**Non-Goals:**

- Recovering logs already cascaded away. They are gone.
- Preserving `care_occurrence` (nag/send state) past its item — see D6.
- Snapshotting the item's `note`. It is an instruction for performing the task, not part of the
  record's identity; the spec asks for title, category and dose only.
- Any restore/undelete UI for care items.

## Decisions

### D1: Denormalize a snapshot onto `care_log`, not soft-delete `care_item`

`care_log` gains `item_title` (`text NOT NULL`), `item_category` (`text NOT NULL`) and `item_dose`
(`text`, nullable). Every writer fills them from the item it already has in hand.

`item_category` is plain `text`, mirroring `care_item.category`: there is no `care_category`
Postgres enum in this repo (the only `CREATE TYPE`s are `food_entry_source`, `food_measure_unit`,
`reminder_occurrence_status` and `care_log_status`). The constrained set lives in the domain layer
as the `CareCategory` string union, so adding a category needs no schema change or migration. That
also matters for the deploy-window `DEFAULT 'custom'` below: on a `text` column it is an ordinary
value, not a type-level commitment.

Alternative considered — soft-delete `care_item` (`deleted_at`): it keeps history joinable, but
every read path (list, today, `listActiveSchedules`, the cron scan, stock, the assistant tools)
would need a `deleted_at IS NULL` predicate, and a missed one silently resurrects a deleted item
into a reminder. That is a filter-everywhere invariant enforced by nobody; this repo has already
been bitten by exactly that shape. The snapshot pushes the cost onto the three write paths, which
are enumerable and already hold the item.

Alternative considered — a `deleted_care_item` tombstone table the log joins to: same information,
one more table, one more join, and the log is still not self-contained.

The snapshot is deliberately *not* kept in sync when the item is renamed. A record says what was
taken at the time, and the title at the time is the honest answer (spec: "A record keeps the name
the item had"). The live item's current title still wins for records whose item still exists — see
D4 — so a rename is visible where it should be and history is not rewritten where it should not.

### D2: `ON DELETE SET NULL` with nullable id columns

`care_log.care_item_id` and `care_log.care_schedule_id` become nullable, with their foreign keys
recreated as `ON DELETE SET NULL`. `NULL` then means exactly one thing: the plan that produced
this record no longer exists.

Alternative considered — drop the foreign keys and keep the ids as dangling text. That loses the
database's own guarantee that a non-null id points at a real row, which is what makes "null means
deleted" trustworthy in the first place.

Note the interaction with the unique constraint `(care_schedule_id, local_date, time_of_day)`:
Postgres treats `NULL`s as distinct, so orphaned rows silently leave that constraint's scope. That
is acceptable and not worth `NULLS NOT DISTINCT`: no writer can produce a `NULL`
`care_schedule_id` — every one of them resolves the schedule through
`careItemRepo.getByScheduleId` (or holds a live schedule from the cron scan) and bails out when it
is gone — so an orphan row is only ever *made* orphaned by the cascade, never inserted as one.

### D3: `getCareRange` becomes a union of two sources, still two reads

The use case already fetches all of the user's items-with-schedules and all logs in the range, in
two calls. Keep both, and change the assembly:

1. Expand live schedules per date exactly as today, consuming the matching log by the existing
   `${careScheduleId}|${timeOfDay}|${localDate}` key, and record the consumed log's id in a set.
2. After the expansion, emit one slot per log whose id was never consumed, on the log's own
   `localDate`, from the log's own fields — `status` is the stored status verbatim (no derivation:
   there is no schedule to derive `pending`/`overdue`/`missed` from), `timeOfDay`, `doseQuantity`
   and `doneTime` likewise.
3. Sort each day with the existing `timeOfDay` then `title` comparator, so unmatched records
   interleave with live slots rather than being appended in a second block.

This subsumes both halves of the bug: a deleted item's logs, and a log whose schedule still exists
but is disabled or inactive on that date (which today's code also drops). "Every log in the range
appears exactly once" is a single invariant that covers both, and is testable without enumerating
the reasons a slot can go missing.

`getCareToday` is deliberately *not* given this treatment: today's list is a to-do list.

**Accepted consequence — a `missed`/`done` pair on the same item, date and time.** The union keys
step 1's consumption by `(careScheduleId, timeOfDay, localDate)`, so a record whose schedule id is
now `NULL` can never be consumed by a live slot. Remove an item's 08:00 schedule after answering it
and then add 08:00 back: the new schedule expands into a past-day slot with no log of its own
(derived `missed`), and the old record surfaces unconsumed (`done`, with a null schedule id). The
user sees two 08:00 rows for one item, one missed and one done. Accepted: each row is individually
true — nothing was recorded against the new schedule, and something *was* recorded against the old
one — and the only ways to collapse them are to key the union by `(itemId, timeOfDay, localDate)`,
which lets a live slot swallow a record written under different terms, or to suppress the orphan,
which deletes history that actually happened. That is the failure this change exists to remove, so
a confusing pair is the better trade. Pinned by a test in `get-care-range.test.ts` so it is not
"tidied up" later without revisiting this paragraph.

### D4: Naming resolution — live item first, snapshot as the fallback

For an unmatched log: look its `careItemId` up in the items already fetched in step 1 (a
`Map<itemId, item>` built from the same array — no extra query). Found: use the live
`title`/`category`/`dose` and report `itemDeleted: false`. Not found or `careItemId === null`: use
the snapshot and report `itemDeleted: true`.

This keeps a rename visible for a still-existing item whose schedule merely lapsed, and makes the
snapshot the answer only when there is nothing better. It is also total — every log resolves,
including hypothetical rows the two cases above do not anticipate.

### D5: `CareTodaySlot` carries the new fields; both endpoints share it

`careItemId` and `careScheduleId` become `string | null`, and the type gains
`itemDeleted: boolean`. `careTodaySlotToJson` — shared by `/api/care/today`, `/api/care/range` and
the `/api/health/overview` `care_range` section — emits `item_deleted` for all of them (always
`false` on the today path).

Alternative considered — a separate `CareRangeSlot` type so today's payload is untouched. Rejected:
the two payloads are produced by one shared serializer precisely so they cannot drift, and a second
type would fork it. A field that is constantly `false` on one path is a smaller cost than two
serializers.

### D6: `care_occurrence` keeps its cascading foreign keys

`care_occurrence` is nag and send state for a slot, not history. Deleting an item must stop the
nagging, and orphaned occurrences would only be rows every sweep has to skip.
`markMissedForUserDay` already tolerates an occurrence whose schedule is gone. Only `care_log`
changes.

### D7: Answering or editing a deleted item's slot needs no new guard

`answerCareSlot` and `editCareSlot` both start from `careItemRepo.getByScheduleId`, which returns
`null` once the schedule is gone, and both already turn that into a 404. The spec's "no new
adherence record can be written for it" is satisfied by existing code; the tasks add a test that
pins it rather than new logic.

## Risks / Trade-offs

- **The backfill must run in the same migration as the `SET NOT NULL`** → one migration file:
  add the three columns nullable, `UPDATE care_log SET item_title/item_category/item_dose FROM
  care_item`, then `ALTER ... SET NOT NULL` on title and category. Every current row has a
  non-null `care_item_id` pointing at a live row (today's cascade guarantees it), so the backfill
  is total. Drizzle-kit will not generate the `UPDATE`; it is hand-added to the generated file
  between the `ADD COLUMN`s and the `SET NOT NULL`s, and the file must be read after generation
  rather than assumed.
- **Snapshot drift is intentional and will look like a bug** → the doc comment on the columns says
  so explicitly, and D4's live-item-wins rule limits the visible surface to records whose item is
  actually gone.
- **Clients get nullable `care_item_id` / `care_schedule_id` in range slots** → the life-os
  frontend's history view must handle it before this is user-visible; that is a companion frontend
  issue, tracked separately. The today payload and every live-item range slot keep non-null ids, so
  only genuinely-deleted records can trip a client.
- **History can now grow with records whose schedules are long gone** → the range is still capped
  at `MAX_RANGE_DAYS` and a log exists only where something was actually recorded, so the response
  is bounded by real history, not by the number of deleted items.
- **The two new `NOT NULL` columns need a `DEFAULT`, or the deploy window 500s** →
  `.github/workflows/deploy.yml` runs `npm run db:migrate` *before* the `Deploy Worker` step, so for
  the minutes in between the OLD Worker is live and its `care_log` inserts carry none of the three
  new columns. `item_title`/`item_category` `NOT NULL` with no `DEFAULT` therefore makes every
  care-log write in that window fail — `POST /api/care/log`, the edit, and the
  `markMissedForUserDay` / `retireOrphanedOccurrences` writes inside running
  `CareReminderWorkflow` instances (verified against PGlite: `null value in column "item_title" of
  relation "care_log" violates not-null constraint`). The migration therefore ends with
  `SET DEFAULT ''` on `item_title` and `SET DEFAULT 'custom'` on `item_category` (`custom` is a real
  `CareCategory`, and on a plain `text` column an ordinary value rather than a type-level
  commitment — see D1). Set *after* the backfill, not on the `ADD COLUMN`, so a row the backfill's
  join missed still trips the `SET NOT NULL` instead of silently getting `''`. Pinned by
  `test/db/care-log-snapshot-backfill.test.ts`, which applies 0000–0035, inserts pre-change
  `care_log` rows, then applies 0036 — the only arrangement in which the backfill and the
  `SET NOT NULL` run against anything. `test/db/harness.ts` cannot: it migrates an empty database in
  one pass, so deleting the backfill `UPDATE` leaves the rest of the `db` project green. The handful
  of rows the window writes carry an empty snapshot, which no user can see: their `care_item_id` is
  still non-null at that point, and D4 reads the live item in preference to the snapshot. The
  `DEFAULT`s are permanent — no follow-up drop.
- **The `DEFAULT`s live in the migration only, deliberately not in `src/shared/db/schema.ts`** →
  the deploy window's writer is the previously deployed bundle, which never reads this repo's
  current TypeScript, so the SQL-level `DEFAULT` is both necessary and sufficient for it. Declaring
  `.default("")` / `.default("custom")` on the Drizzle columns would buy nothing there and would
  remove the compile-time guarantee that every *new* writer fills the snapshot: with the columns
  plain `.notNull()`, dropping `itemTitle` from either insert in
  `drizzle-care-log-repository.ts` fails `npm run typecheck` with `TS2769`; with `.default()`
  present the same omission typechecks clean and inserts `''` at runtime. Asymmetry between the two
  layers is the point, and is noted in both files.
- **Rollback**: the schema change is additive and relaxing (new columns, `NOT NULL` dropped,
  cascade weakened), and the two new `NOT NULL` columns carry `DEFAULT`s, so the previous code —
  which does not send them — still inserts successfully; every row it reads has non-null ids until
  something is deleted. Rolling back code alone is safe **because of those `DEFAULT`s**: drop them
  and a code-only rollback breaks every care-log write, exactly as the deploy window above would.
  Rolling back the migration is not safe, and is not planned.

## Migration Plan

1. Deploy the migration (columns + backfill + `DEFAULT`s + FK swap). Old code keeps working against
   it *because* of the `DEFAULT`s on the two new `NOT NULL` columns — see Risks: migrate runs before
   the Worker deploy, and the old writers send none of the three new columns.
2. Deploy the writers (snapshot on every insert/upsert) and the read path together — the read
   path's snapshot fallback is only reachable for rows written before it if the backfill ran, which
   step 1 guarantees.
3. Frontend picks up `item_deleted` and nullable ids separately.
