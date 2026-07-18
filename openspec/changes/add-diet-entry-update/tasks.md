## 1. Domain + application (TDD)

- [x] 1.1 Add `update(userId, entryId, patch)` to the `DietLogRepository` port, where `patch` = `{ name?, meal?, eatenAt?, portions?{staple,meat,fruit,veg} }`; returns the updated `FoodEntry` or `null` when not owned/found
- [x] 1.2 Write use-case unit tests (in-memory repo) then implement `UpdateFoodEntry`: rejects an empty patch (no fields) as invalid; passes a non-empty patch through; returns null → caller treats as not found
- [x] 1.3 In the in-memory test repo, implement `update` so its behavior (owner scoping; portions→nutrients recompute via the conversion module + `unclassified=false`; merge of supplied fields; omitted fields unchanged) is exercised by the use-case tests

## 2. Infrastructure

- [x] 2.1 Implement `DrizzleDietLogRepository.update`: `WHERE id = :id AND user_id = :userId`; when `portions` supplied, recompute nutrients via the conversion module and set `unclassified=false`; when `eaten_at` supplied, also set `day` to its calendar date (keep day/eaten_at consistent); update only the supplied columns (name/meal/eaten_at/day/portions+nutrients), leaving others unchanged; return the updated row or null. Handle numeric string↔number like the other writes

## 3. HTTP & wiring

- [x] 3.1 Add `PATCH /api/diet-entries/:id` (behind auth): parse optional `name`/`meal`/`eaten_at`/`portions` with the existing validation helpers (eaten_at a valid timestamp, portion values finite ≥ 0); reject an empty patch → 400; call `UpdateFoodEntry`; null result → 404 `{ error: "not_found" }` (matching the delete route); return the updated entry JSON
- [x] 3.2 Wire the `UpdateFoodEntry` use case + route from the composition root `src/index.ts`
- [x] 3.3 Write Workers-pool HTTP tests (inject fakes): update portions recomputes nutrients + clears unclassified; update meal only leaves other fields; updating eaten_at to another calendar date moves the entry's day; empty patch → 400; another user's / missing entry → 404; auth required → 401

## 4. Verify

- [x] 4.1 Run `npm test` and `npm run typecheck`; both green
