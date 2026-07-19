# Tasks — Carry-forward daily portion target

## 1. Repository port
- [ ] 1.1 Add `getLatestOnOrBefore(userId, day): Promise<DailyTarget | null>` to
      the `DailyTargetRepository` port (`domain/daily-target-repository.ts`).

## 2. Use case (TDD)
- [ ] 2.1 Write failing use-case tests for `getDailyTargetWithRemaining`: (a) day
      with own target → base+bonus unchanged; (b) day with no target but an
      earlier one → base = earlier base, bonus 0; (c) never set → all-zero;
      (d) an untouched day *after* a nonzero-bonus target carries its base but
      bonus 0 (source day's bonus does not leak forward).
      Extend the in-memory fake repo with `getLatestOnOrBefore`.
- [ ] 2.2 Update `getDailyTargetWithRemaining`: exact-day `get` wins with its
      base+bonus; otherwise carry base from `getLatestOnOrBefore`, bonus 0.
      Make the tests green.

## 3. Drizzle adapter
- [ ] 3.1 Implement `getLatestOnOrBefore` on `DrizzleDailyTargetRepository`:
      `where userId AND day <= day, order by day desc, limit 1`.

## 4. Verify
- [ ] 4.1 `npm test` and `npm run typecheck` green; no change to set/HTTP/schema.
