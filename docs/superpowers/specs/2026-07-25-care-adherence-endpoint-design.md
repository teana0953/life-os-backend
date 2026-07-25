# 照護達成率 range 端點 — 設計文件

日期:2026-07-25
狀態:已批准方向(前端趨勢圖的後端資料源)

## 目標

前端「照護達成趨勢」需要一段期間內每天的排程數與完成組成。新增
`GET /api/care/adherence?from=&to=` 回傳每日 `{date, scheduled, done, skipped, missed}`,
前端據此算達成率、彙總成週、畫堆疊長條。比照既有 `GET /api/vitals/range`。

## 資料模型與計算

- **scheduled(當日排程數)**:每個 schedule 一天最多一個 slot(單一 `timeOfDay`),所以
  當日排程數 = 當日 `isActiveOn(schedule, localDate)` 為真的 schedule 數。schedule 全集用
  `CareItemRepository.listByUser(userId)`(回 `CareItemWithSchedules[]`)展平取得——不需新增
  schedule-listing 方法。`isActiveOn`(`domain/care-schedule.ts`,已被 care-today/cron 共用)
  處理 weekday / start-end / every-N-weeks,純函式,直接重用。
- **done / skipped / missed**:當日 `care_log` 依 status 計數。past-due 未答覆的 slot 由
  run-care-tick cron 標成 `missed` log,所以已過的完整日通常 done+skipped+missed ≈ scheduled;
  端點只回原始計數,rate 與週彙總交給前端(簡單、彈性)。
- **日期空間**:from/to 是使用者本地日期(同 vitals range);`isActiveOn` 與 log.localDate 皆
  本地日期字串,計算全在本地日期空間,無時區換算問題。

## 架構(比照 vitals range)

- **domain 純函式** `buildCareAdherenceSeries(schedules, logs, from, to)`:逐日 [from,to],
  scheduled = count(isActiveOn),done/skipped/missed = 該日 log 依 status 計數;回
  `{ from, to, days: [{date, scheduled, done, skipped, missed}] }`。純、可單元測。
- **application** `getCareAdherence(deps, userId, from, to)`:讀 schedules(`listByUser`)+
  logs(新 `CareLogRepository.listByUserAndDateRange`),呼叫 builder。
- **repo** 加 `CareLogRepository.listByUserAndDateRange(userId, from, to): Promise<CareLog[]>`
  + Drizzle 實作(單批 `localDate BETWEEN from AND to`)。
- **route** `GET /api/care/adherence?from=&to=`:`requireDay` 驗 from/to;span 上限
  `MAX_RANGE_DAYS = 366`(超過 400,同 vitals);snake `{from, to, days:[{date, scheduled,
  done, skipped, missed}]}`。auth middleware 同其他 care 端點。

## 不做(YAGNI)

- 不在後端算 rate / 週彙總(前端做)。
- 不做 per-category / per-item 拆分(前端先做「全部」;之後要拆再擴充 query)。
- 不動 care-today / care-log 寫入 / cron。

## 驗收標準

1. `GET /api/care/adherence?from=&to=` 回每日 `{date, scheduled, done, skipped, missed}`,
   涵蓋 [from,to] 每一天(含 scheduled=0 的日子)。
2. scheduled 正確反映 `isActiveOn`(weekday / start-end / every-N-weeks 生效)。
3. done/skipped/missed 反映該日 care_log 計數。
4. from/to 非法 → 400;span > 366 → 400。
5. 未帶 token → 401;只回呼叫者自己的資料。

## 測試策略

- `buildCareAdherenceSeries` 單元測試:多日、跨 weekday/interval 的 scheduled 展開、log 計數、
  空日、邊界日。
- `getCareAdherence` 用 in-memory repo 測整合。
- route 測(workers pool):參數驗證、span 上限、401、snake 輸出、注入 fake repo。
