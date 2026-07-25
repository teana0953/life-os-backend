## 1. Ports + repo methods

- [ ] 1.1 (green) `CareLogRepository` 加 `listByUserAndDateRange(userId, from, to)` +
      `upsert(input): Promise<{log, previousStatus: CareLogStatus|null}>`(覆寫);`CareItemRepository`
      加 `incrementStock(itemId, amount)`。補所有現有 fakes 的 stub 讓 `npm run typecheck` 綠。
- [ ] 1.2 (red/green) `DrizzleCareLogRepository.listByUserAndDateRange`(between)+ `upsert`
      (讀舊 status → 覆寫 → 回 previousStatus)測試;`DrizzleCareItemRepository.incrementStock` 測試。

## 2. getCareRange use case

- [ ] 2.1 (red) `getCareRange(deps, userId, from, to, now)` in-memory 測試:逐日展開啟用排程
      (isActiveOn)、join log、狀態推導(log 優先;past→missed、today→overdue/pending、future→pending)、
      停用/非 active 不出 slot、跨時區 today。
- [ ] 2.2 (green) `src/contexts/notifications/application/get-care-range.ts`(重用 getCareToday
      的 slot 組法 + isActiveOn;一次 listByUser + 一次 range logs)。

## 3. editCareSlot use case

- [ ] 3.1 (red) `editCareSlot` 測試:覆寫 status;庫存 delta(not-done→done 扣、done→not-done 退、
      no-op 不動、clamp≥0、非 medication/stock null 不動);非 owner → null。
- [ ] 3.2 (green) `src/contexts/notifications/application/edit-care-slot.ts`(owner-scope、
      `upsert` 回 previousStatus、依 prev/new 算 stock delta 呼 decrement/increment)。

## 4. HTTP routes

- [ ] 4.1 (red) route 測試(workers pool):`GET /api/care/range`(per-day slots、400 缺/壞/from>to/
      span>366、401、per-user、snake、停用不出);`PUT /api/care/log`(覆寫、庫存連動、非 owner 404、
      401、status 驗證)。
- [ ] 4.2 (green) `routes/care.ts` 加兩路由(range 用 requireDay+from>to+MAX_RANGE_DAYS=366+自帶
      daySpan;put 驗 status∈done|skipped),註冊於 `app.ts`,inject deps。

## 5. Gate

- [ ] 5.1 `npm test` + `npm run typecheck` 全綠。
