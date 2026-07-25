## Why

前端「照護達成趨勢」圖需要一段期間內每天的照護排程數與完成組成(完成/略過/未完成)。目前
只有單日 `GET /api/care/today`,沒有 range 聚合端點。新增 `GET /api/care/adherence?from=&to=`
作為趨勢圖的資料源,比照既有 `GET /api/vitals/range`。

## What Changes

- **domain**:新增純函式 `buildCareAdherenceSeries(schedules, logs, from, to)`
  (`src/contexts/notifications/domain/care-adherence.ts`)——逐日 [from,to]:`scheduled` =
  該日 `isActiveOn(schedule, localDate)` 為真的 schedule 數(重用既有
  `domain/care-schedule.ts` 的 `isActiveOn`,單一 timeOfDay/schedule = 1 slot/day);
  `done`/`skipped`/`missed` = 該日 `care_log` 依 status 計數。回
  `{ from, to, days: [{ date, scheduled, done, skipped, missed }] }`,涵蓋每一天(含 0)。
- **domain port**:`CareLogRepository`(`domain/care-log.ts`)新增
  `listByUserAndDateRange(userId, from, to): Promise<CareLog[]>`。
- **application**:新增 `getCareAdherence(deps, userId, from, to)`
  (`application/get-care-adherence.ts`)——讀 `CareItemRepository.listByUser(userId)` 展平
  schedules + 新的 log range 查詢,呼叫 builder。
- **adapters**:`DrizzleCareLogRepository` 實作 `listByUserAndDateRange`(單批
  `local_date BETWEEN from AND to`,scoped by user)。
- **http**:新增 `GET /api/care/adherence?from=&to=`(`routes/care.ts` + 註冊於 `app.ts`),
  auth middleware;`requireDay` 驗 from/to;span 上限 `MAX_RANGE_DAYS = 366`(超過 400);
  snake 輸出 `{ from, to, days: [{ date, scheduled, done, skipped, missed }] }`。

不在後端算 rate / 週彙總(前端做);不做 per-category/per-item 拆分(前端先做「全部」);
不動 care-today / care-log 寫入 / run-care-tick cron。
Gate = `npm test` + `npm run typecheck`。

## Capabilities

### Modified Capabilities

- `care-reminders`: 新增照護達成率 range 端點——回傳一段本地日期期間內每天的排程數與
  完成/略過/未完成計數,作為前端照護達成趨勢圖的資料源。
