## Why

Deleting a care item silently destroys the user's adherence history: `care_log.care_item_id` /
`care_log.care_schedule_id` are `ON DELETE CASCADE` (`drizzle/0015_loud_mauler.sql:59-63`), so
`DrizzleCareItemRepository.delete`'s hard delete takes every record of every dose ever taken with
it (issue #242). A second, independent layer hides records even when they survive: `getCareRange`
builds history by expanding the *currently existing* schedules and then pasting logs onto the
resulting slots, skipping any schedule that is disabled or inactive on the date — a log with no
matching live schedule can never be rendered, whatever the foreign key does.

A care log is a statement about something that actually happened. It must outlive the plan that
produced it.

## What Changes

- **BREAKING (database)**: `care_log.care_item_id` and `care_log.care_schedule_id` become nullable
  and their foreign keys change from `ON DELETE CASCADE` to `ON DELETE SET NULL`. Deleting a care
  item no longer deletes its logs.
- `care_log` gains a denormalized snapshot of the item as it was when the log was written:
  `item_title`, `item_category` (both `NOT NULL`, backfilled from `care_item` for existing rows)
  and `item_dose` (nullable). Every writer of a log (`answerCareSlot`, `editCareSlot`,
  `markMissedForUserDay`) records the snapshot; the log becomes a self-contained fact.
- Care item deletion stays a real delete — no soft-delete flag, no tombstone row.
- `getCareRange` no longer loses logs it cannot match to a live slot. Its contract becomes: every
  `care_log` in `[from, to]` appears in the response exactly once, on its own `local_date`. Logs
  with no matching expanded slot are emitted from the log itself, using the snapshot for
  title/category/dose.
- **BREAKING (API)**: `/api/care/range` slots gain `item_deleted` (boolean), and `care_item_id` /
  `care_schedule_id` become nullable in the slot payload. Each id is null exactly when its own
  parent row is gone, which is **not** the same question as `item_deleted`: a slot can carry
  `item_deleted: false` with a non-null `care_item_id` and a **null `care_schedule_id`** whenever
  the item is still live and only that time-of-day's schedule was removed (an item edit dropping
  one time). Clients must therefore key "deleted" off `item_deleted` alone and never infer it from
  a null `care_schedule_id`. Today's list (`/api/care/today`), the reminder dispatch, and the
  assistant's care tools continue to show only live items.
- Existing already-cascaded data is unrecoverable; this change is forward-only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `care-reminders`: deleting a care item preserves its adherence records; the date-range history
  requirement changes from "the slots each live schedule produces" to "every log in the range,
  plus the slots each live schedule produces", with deleted-item records flagged and named from
  their snapshot. Today's list and reminder delivery are explicitly unchanged.

## Impact

- Database: `care_log` (three new columns, two FK definitions, two columns made nullable); one new
  Drizzle migration with a data backfill. `care_occurrence` keeps its cascading foreign keys — it
  is ephemeral send/nag state, not history.
- Code: `src/shared/db/schema.ts`; `src/contexts/notifications/domain/care-log.ts`;
  `src/contexts/notifications/adapters/drizzle-care-log-repository.ts`;
  `src/contexts/notifications/application/{answer-care-slot,edit-care-slot,run-care-day,get-care-range,get-care-today}.ts`;
  `src/adapters/http/routes/care.ts`; `src/contexts/assistant/application/tools.ts`.
- API consumers: the life-os frontend's care history view must render `item_deleted` slots and
  tolerate null `care_item_id` / `care_schedule_id`; `/api/health/overview`'s `care_range` section
  and the assistant's `get_care_range` tool carry the same new shape.
