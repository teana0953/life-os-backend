## Why

前端「照護達成趨勢」圖需要一段期間內每天的照護排程數與完成組成(完成/略過/未完成)。目前
只有單日 `GET /api/care/today`,沒有 range 聚合端點。新增 `GET /api/care/adherence?from=&to=`
作為趨勢圖的資料源,比照既有 `GET /api/vitals/range`。

## What Changes

- **domain**:新增純函式 `buildCareAdherenceSeries(schedules, logs, from, to)`
  (`src/contexts/notifications/domain/care-adherence.ts`)——逐日 [from,to]:`scheduled` =
  該日**且 `enabled===true`** 的 schedule 中 `isActiveOn(schedule, localDate)` 為真的數量
  (builder 內自行過濾 `enabled`——`isActiveOn` 與 `listByUser` 都不濾 enabled,而其他 active
  路徑都濾;停用排程不會產生 log,不濾會灌水 scheduled、低估達成率;單一 timeOfDay/schedule
  = 1 slot/day);`done`/`skipped`/`missed` = 該日 `care_log` 依 status 計數。回
  `{ from, to, days: [{ date, scheduled, done, skipped, missed }] }`,涵蓋每一天(含 0)。
  **注意**:`scheduled` 由**當前**排程定義回溯套用到每一過去日,而 log 是歷史列;使用者編輯/
  停用/刪除排程後,過去日可能不對稱(done 可能 > scheduled、或 missed 落在 scheduled=0 的日)。
  這是「原始計數、rate 交前端」模型的固有取捨;前端算 rate 時 clamp ≤100%。
- **domain port**:`CareLogRepository`(`domain/care-log.ts`)新增
  `listByUserAndDateRange(userId, from, to): Promise<CareLog[]>`。
- **application**:新增 `getCareAdherence(deps, userId, from, to)`
  (`application/get-care-adherence.ts`)——讀 `CareItemRepository.listByUser(userId)` 展平
  schedules + 新的 log range 查詢,呼叫 builder。
- **adapters**:`DrizzleCareLogRepository` 實作 `listByUserAndDateRange`(單批
  `local_date BETWEEN from AND to`,scoped by user)。**port 擴充連帶**:現有的
  `CareLogRepository` fakes(care.test.ts、get-care-today.test.ts、answer-care-slot.test.ts、
  run-care-tick.test.ts)要補一個 no-op stub 讓 `npm run typecheck` 維持綠。
- **http**:新增 `GET /api/care/adherence?from=&to=`(`routes/care.ts` + 註冊於 `app.ts`),
  auth middleware;`requireDay` 驗 from/to;**`from > to` → 400**(比照 vitals);span 上限
  `MAX_RANGE_DAYS = 366`(超過 400);snake 輸出
  `{ from, to, days: [{ date, scheduled, done, skipped, missed }] }`。
  (`daySpan` 在 vitals.ts 是私有未匯出,care route 自帶一份小 helper,YAGNI。)

不在後端算 rate / 週彙總(前端做);不做 per-category/per-item 拆分(前端先做「全部」);
不動 care-today / care-log 寫入 / run-care-tick cron。
Gate = `npm test` + `npm run typecheck`。

## Capabilities

### Modified Capabilities

- `care-reminders`: 新增照護達成率 range 端點——回傳一段本地日期期間內每天的排程數與
  完成/略過/未完成計數,作為前端照護達成趨勢圖的資料源。
