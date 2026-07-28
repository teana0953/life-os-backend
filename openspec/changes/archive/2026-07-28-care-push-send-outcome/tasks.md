## 1. schema + migration

- [x] 1.1 `src/shared/db/schema.ts` 的 `careOccurrence` 加三個 **nullable** 欄位:
      `lastAttemptAt`(timestamptz)、`lastSendOutcome`(text)、`lastSendDetail`(text)。
- [x] 1.2 `npm run db:generate` 產生 migration,檢查產出的 SQL 只有 `ADD COLUMN`
      (三個都 nullable → 既有列不需回填、無破壞性)。

## 2. domain port + adapter(**新增 `recordAttempt`,先保留 `touchNotified`**)

- [x] 2.1 (red) `test/contexts/notifications/adapters/drizzle-care-occurrence-repository.test.ts`:
      `recordAttempt` 會寫入 `last_attempt_at` / `last_send_outcome` / `last_send_detail`,
      且**只有** `delivered === true` 時才更新 `last_notified_at`。
      **同一步**補該檔 `CREATED_ROW`(它是 `$inferSelect` 形狀)的三個新欄位,
      否則 adapter 測試編不過。
- [x] 2.2 (green) `CareOccurrence` 實體加三個欄位;`CareOccurrenceRepository`
      **新增** `recordAttempt(id, { at, outcome, detail, delivered })`,
      **這一步先保留 `touchNotified`** —— 換掉它會讓 `run-care-tick.ts` 與測試的
      in-memory fake 同時編不過,3.1 的 red 訊號就無法與編譯錯誤區分。
      `Drizzle` adapter 實作 `recordAttempt`。
      **同一步還要改這兩處,否則會有中途紅窗與一個安靜的行為 bug**:
      - `drizzle-care-occurrence-repository.ts` 的 **`toDomain()` 必須映射三個新欄位** ——
        漏了的話 `dispatchSlot` 拿到的 `lastSendOutcome` 恆為 `undefined`,
        **D11 的 `sent` 分支永遠不成立** → `nag = 0` 送成功後會每 10 分鐘重送;
        而且 2.1 補了 `CREATED_ROW` 之後 `toEqual(CREATED_ROW)` 也不會綠。
      - `run-care-tick.test.ts` 的 `InMemoryCareOccurrenceRepository`:
        `upsertBySlot` 的物件字面值要補三個欄位(值為 `null`,不是 `undefined`),
        並加上 `recordAttempt`,否則這一步結束時 `npm run typecheck` 必紅。

## 3. runCareTick:成敗要影響狀態與重試

- [x] 3.1 (red) `test/contexts/notifications/application/run-care-tick.test.ts`:
      - 全數失敗(非 expired)→ **不**更新 `lastNotifiedAt`,但**有**寫 `lastAttemptAt`
        與 `outcome: failed` + `detail`;
      - **部分成功**(一個 sent、一個 failed)→ **算 delivered**,`lastNotifiedAt` 有更新;
      - **零訂閱** → `outcome: no_subscriptions`,`lastNotifiedAt` 不更新(維持既有行為:
        否則 `nag = 0` 的排程在之後補上訂閱時永遠不再發);
      - **整輪全 expired** → outcome `expired`、**不**更新 `lastNotifiedAt`,訂閱仍被刪;
      - **重試節流**:上一輪未送達後,下一次 tick 若距 `lastAttemptAt` 不足
        `RETRY_INTERVAL_MINUTES` → **不重送**;超過 → 重送。
        **特別涵蓋 `nagIntervalMinutes = 0`** —— 那正是會退化成每分鐘重試的情形。
      - **★ 已送達後才失敗的那條路徑**(design D11 的關鍵案例,原本漏了):
        `nag > 0`、先成功送過一次、之後某輪**全失敗** → 下一次必須受 floor 節流,
        **不可**因為 `lastNotifiedAt` 停在舊的成功時間而每分鐘重試。
      - **既有行為不變**(這幾條都有既有測試,不可弄紅):`nag = 0` 且**送成功**後不再發;
        `nag = 10` 的正常 nag 間隔仍是 10(**不被 RETRY floor 拉長**);答覆後停止;
        **零訂閱一輪 → 60 秒後補上訂閱 → 立刻送出**(D12:no_subscriptions 不套 floor)。
- [x] 3.2 (green) `dispatchSlot` 改成:蒐集這一輪每個訂閱的 outcome → 彙總成
      `sent`(任一成功)/ `expired`(全 gone)/ `failed`(其餘全失敗)/ `no_subscriptions`;
      `detail` **帶該輪計數**(如 `sent=1 failed=2 status_401`);呼叫 `recordAttempt`。
      `shouldNotify` 依 **design D11** 分兩條:
      - `lastSendOutcome === 'sent'` → 間隔 `nagIntervalMinutes`、基準 `lastNotifiedAt`
        (**完全維持既有語意**);
      - 否則 → 間隔 `max(nagIntervalMinutes, RETRY_INTERVAL_MINUTES)`、基準 `lastAttemptAt`。
      `RETRY_INTERVAL_MINUTES = 10`,放在 `LOOKBACK_MINUTES` 旁邊。
      **`no_subscriptions` 不套 floor**(design D12),且**只在 outcome 變化時才寫**。
- [x] 3.3 (refactor) 全部呼叫端切到 `recordAttempt` 後,**移除 `touchNotified`**
      (port、Drizzle adapter、測試的 in-memory fake)。此時 `npm test` 與
      `npm run typecheck` 必須全綠。

## 4. gate

- [x] 4.1 `npm test` + `npm run typecheck` 全綠。
