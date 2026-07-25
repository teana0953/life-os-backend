## 1. Ports + repo methods

- [x] 1.1 (green) `CareLogRepository` 加 `listByUserAndDateRange(userId, from, to)` +
      `upsert(input): Promise<{log, previousStatus: CareLogStatus|null}>`(覆寫);`CareItemRepository`
      加 `incrementStock(itemId, amount)`。補所有現有 fakes 的 stub 讓 `npm run typecheck` 綠。
- [x] 1.2 (red/green) `DrizzleCareLogRepository.listByUserAndDateRange`(between)+ `upsert`
      (讀舊 status → 覆寫 → 回 previousStatus)測試;`DrizzleCareItemRepository.incrementStock` 測試。

## 2. getCareRange use case

- [x] 2.0 (green) `reminder-clock.ts` 加 `nextLocalDate`(鏡射既有 `previousLocalDate` 的
      UTC-midnight 數學,不重造),供逐日列舉;單元測試。
- [ ] 2.1 (red) `getCareRange(deps, userId, from, to, now)` in-memory 測試:逐日(用 nextLocalDate
      列舉 [from,to])展開排程、join log、狀態推導(log 優先;past→missed、today→overdue/pending、
      future→pending);**明確測「停用 schedule 不出 slot」**(因用 listByUser 未過濾 enabled,
      builder 須同時套 `schedule.enabled && isActiveOn`)、非 active 不出、跨時區 today、多日展開。
- [ ] 2.2 (green) `src/contexts/notifications/application/get-care-range.ts`(重用 getCareToday
      的 slot 組法;**顯式 `enabled && isActiveOn`**;一次 listByUser + 一次 range logs)。

## 3. editCareSlot use case

- [ ] 3.1 (red) `editCareSlot` 測試:覆寫 status;庫存 delta(not-done→done 扣、done→not-done 退、
      no-op 不動、clamp≥0、非 medication/stock null 不動);非 owner → null。**pin clamp 不對稱**:
      若先前 decrement 曾被 clamp 到 0,之後 done→not-done 會 increment 全劑(可能高於原值)——
      斷言此既有語意(同 answer-care-slot),不當 bug。
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
