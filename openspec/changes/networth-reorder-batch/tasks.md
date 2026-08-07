# Tasks

## 1. Domain / application / adapter / route (issue #80)

- [x] 1.1 `NetWorthRepository.reorderAccounts(userId, kind, orderedIds)` port method.
- [x] 1.2 `reorderNetWorthAccounts` use case: validates `orderedIds` is exactly the
      user's account id set for `kind` (including archived); rejects any
      mismatch with `NetWorthAccountOrderMismatch` (400) before touching the
      repository.
- [x] 1.3 `DrizzleNetWorthRepository.reorderAccounts`: one `db.batch` of
      per-account `UPDATE`s, all-or-nothing.
- [x] 1.4 `InMemoryNetWorthRepository.reorderAccounts` fake for HTTP-layer tests.
- [x] 1.5 `PUT /api/finance/networth/accounts/order`, registered before
      `PUT /accounts/:id`.

## 2. Tests

- [x] 2.1 DB-layer atomicity test (PGlite, `withBatchShim`): a failure partway
      through the batch leaves every row's `sort_order` unchanged.
- [x] 2.2 HTTP-layer: `ids` missing one account -> 400, nothing written.
- [x] 2.3 HTTP-layer: `ids` with an extra unknown id -> 400, nothing written.
- [x] 2.4 HTTP-layer: `ids` smuggling another user's or another kind's account
      -> 400, nothing written.
- [x] 2.5 HTTP-layer: archived account included and reordered -> 200, gets its
      own `sort_order`.

## 3. Verification

- [x] 3.1 `npm test` and `npm run typecheck` both clean.
- [x] 3.2 `openspec validate networth-reorder-batch --strict` clean.
