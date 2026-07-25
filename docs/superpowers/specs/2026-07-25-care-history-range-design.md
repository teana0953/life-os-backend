# 照護 history:per-slot range 查詢 + 可編輯 log — 設計文件

日期:2026-07-25
狀態:已批准方向(records-based;對齊 CareFlow history)

## 目標

前端「照護 history」(趨勢 heatmap + 歷史紀錄清單 + 編輯)改用 **per-slot 紀錄**當單一資料源
(CareFlow 的 heatmap 也是從 logs 算)。後端補:一段期間的 per-slot 查詢,與可覆寫過去紀錄的
編輯端點(含庫存連動)。`#50` 聚合端點被取代、parked。

## Decisions

- **range = getCareToday 推廣到多日**:`getCareRange(deps, userId, from, to, now)` 重用 care-today
  的 slot 組法 + `isActiveOn`(只算 **enabled** 排程)。效能:一次 `listByUser` + 一次
  `listByUserAndDateRange`(logs),逐日 in-memory 展開(避開 per-day N 查詢,同 health-calendar/#50)。
- **狀態推導**:`log ? log.status : (date<today ? "missed" : today ? (slotMinute<=now?"overdue":
  "pending") : "pending")`。today/now 依 owner timezone(同 care-today)。
- **編輯 = 覆寫 + 庫存 delta**:`editCareSlot` 用 `careLogRepo.upsert`(覆寫回 previousStatus);
  medication 且 stock≠null 時依 prev/new 的 done 分類算 delta(not-done→done 扣、done→not-done
  退、no-op 不動、clamp≥0)。`status∈done|skipped`(missed 系統推導,不開放手改)。與 `POST
  /api/care/log`(insert-if-absent,今日答覆)分開,避免動到「首次才扣庫存」語意。
- **新 repo 能力**:`CareLogRepository.listByUserAndDateRange` + `upsert`(覆寫);
  `CareItemRepository.incrementStock`(現只有 decrementStock)。

## Out of scope

不動 `POST /api/care/log` / cron / care-today;不做 per-category 拆分;不開放把狀態改成 missed。

## 測試策略

- use case in-memory 測試(getCareRange 狀態推導/enabled/時區;editCareSlot 覆寫+庫存 delta+owner)。
- Drizzle repo 測試(range between、upsert 回 previousStatus、incrementStock)。
- route 測試(workers pool):range 參數驗證/per-user/snake/停用不出;put 覆寫/庫存/owner/401/status。
