## 1. Domain series builder

- [x] 1.1 (red) 單元測試 `buildCareAdherenceSeries(schedules, logs, from, to)`:多日展開;
      scheduled 隨 weekday/start-end/every-N-weeks 生效(重用 isActiveOn);**停用 schedule 不計入
      scheduled**;done/skipped/missed 依 log status 計數;空排程日 scheduled=0;done+skipped+
      missed 可小於 scheduled(pending);邊界日(from/to 當天)含入。
- [x] 1.2 (green) 實作 `src/contexts/notifications/domain/care-adherence.ts`——逐日 [from,to],
      **builder 內先濾 `enabled===true`** 再套 `isActiveOn`;回
      `{from,to,days:[{date,scheduled,done,skipped,missed}]}`。

## 2. Log range 查詢

- [ ] 2.1 (red) `DrizzleCareLogRepository.listByUserAndDateRange` 測試(或 in-memory port 測試)。
- [ ] 2.2 (green) `CareLogRepository` port 加 `listByUserAndDateRange(userId, from, to)`;
      `DrizzleCareLogRepository` 實作(單批 `local_date BETWEEN from AND to`,scoped by user)。
      **連帶**:補現有 fakes 的 stub(care.test.ts、get-care-today.test.ts、
      answer-care-slot.test.ts、run-care-tick.test.ts)讓 `npm run typecheck` 維持綠。

## 3. Use case

- [ ] 3.1 (red) `getCareAdherence` 用 in-memory repo 整合測試(schedules 來自 listByUser,
      logs 來自 range 查詢)。
- [ ] 3.2 (green) 實作 `src/contexts/notifications/application/get-care-adherence.ts`。

## 4. HTTP route

- [ ] 4.1 (red) route 測試(workers pool):每日輸出、參數驗證(400)、`from > to`(400)、
      span>366(400)、401、snake 輸出、注入 fake repo 只回自己的資料。
- [ ] 4.2 (green) `routes/care.ts` 加 `GET /api/care/adherence?from=&to=`(requireDay、
      `from > to` → 400、MAX_RANGE_DAYS=366、自帶 daySpan helper、snake 輸出),註冊於 `app.ts`,
      inject 既有 care deps + 新 range 查詢。

## 5. Gate

- [ ] 5.1 `npm test` + `npm run typecheck` 全綠。
