## Why

要對齊使用者自己的 CareFlow app 的 history 功能(趨勢 heatmap + 歷史紀錄清單 + 編輯),前端改用
**per-slot 紀錄**當單一資料源(CareFlow 的 heatmap 也是從 logs 算的)。目前後端只有
`GET /api/care/today`(單日、唯讀不可改)。本變更補兩塊:一段期間的 per-slot 紀錄查詢,與可
覆寫(編輯)過去紀錄的 log 端點(含庫存連動)。`#50`(聚合 adherence)被此 records-based 取代、
parked。

## What Changes

- **`GET /api/care/range?from=&to=`**(唯讀,per-slot):把 `getCareToday` 從單日推廣到 range。
  - 新 use case `getCareRange(deps, userId, from, to, now)`:一次 `careItemRepo.listByUser` 取
    schedules(展平)、一次 `careLogRepo.listByUserAndDateRange` 取 logs(**避開 per-day N 查詢**,
    同 health-calendar/#50 作法);逐日對**啟用**排程套 `isActiveOn`,join 當天 log →
    per-slot。**狀態**:`log ? log.status : (date < today ? "missed" : (slotMinute<=now ? "overdue"
    : "pending"))`(today/now 依 owner timezone)。
  - route:`requireDay` from/to、`from>to`→400、span 上限 `MAX_RANGE_DAYS=366`、auth;snake 輸出
    `{ from, to, days: [{ date, items: [ { care_item_id, care_schedule_id, category, title, note,
    dose, time_of_day, local_date, status, done_time, dose_quantity } ] }] }`(mirror care-today slot)。
- **`PUT /api/care/log`**(可編輯/覆寫,含庫存連動):新 use case
  `editCareSlot(deps, userId, {careScheduleId, localDate, timeOfDay, status})`,`status ∈ done|skipped`。
  - owner-scope(`getByScheduleId`);`careLogRepo.upsert`(**覆寫**,回 `previousStatus`)。
  - **庫存連動(delta)**:medication 且 `stock!==null` 時,`wasDone=prev==="done"`、
    `isDone=status==="done"`:`isDone && !wasDone` → `decrementStock(dose)`;`!isDone && wasDone`
    → `incrementStock(dose)`;其餘不動。clamp ≥0。
- **domain ports**:`CareLogRepository` 加 `listByUserAndDateRange(userId, from, to)` +
  `upsert(input): Promise<{ log; previousStatus: CareLogStatus | null }>`(覆寫);`CareItemRepository`
  加 `incrementStock(itemId, amount)`。Drizzle 實作 + 補現有 fakes stub 維持 typecheck 綠。

**不動**:`POST /api/care/log`(insert-if-absent,今日答覆用)、`run-care-tick` cron、care-today。
不做 per-category 拆分。Gate = `npm test` + `npm run typecheck`。

## Capabilities

### Modified Capabilities

- `care-reminders`: 新增(1)一段本地日期期間的 per-slot 照護紀錄查詢(每天展開啟用排程 × 狀態),
  與(2)可覆寫過去紀錄狀態(done↔skipped)的編輯端點,編輯連動藥品庫存(delta 增減)。
