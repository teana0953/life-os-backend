# 送達結果要影響狀態,且必須留在資料裡 — 設計

日期:2026-07-28
兩軸:`flow_profile = full`、`needs_uiux = false`。

## 背景(真實事故)

使用者回報「排程的照護提醒不會送」但**測試推播收得到**。直接查生產 DB 的結果是:
tick 完全正常 —— cron 活著(當天 08:00:06 準時 materialize)、每天的 occurrence 都在、
`last_notified_at` 都有值。**資料看起來一切正常,而使用者收不到。**

根因:`dispatchSlot` 的 `touchNotified` 只看 `subscriptions.length > 0`,**不看 send 的
outcome**;`WebPushSender` 產出的 `detail` 被整段丟棄。專案**沒有付費 log 產品**,
`runCareTick` 每個 schedule 又有 `catch {}`(D8),所以線上只剩「使用者說收不到」這一個訊號。

## Decisions

### D10. `last_notified_at` = 「至少一封真的送成功」

一輪裡任一訂閱 `outcome === "sent"` 才更新。**部分成功算成功**(使用者已經收到了),
nag 從此照常由 `nagIntervalMinutes` 計算。

### D11. 重試 floor **只在「上一輪未送達」時生效**

這是 proposal-review 抓到的關鍵:規則沒釘死的話,兩種讀法各有一個真 bug。

- 只把 floor 套在 `lastNotifiedAt === null` 分支 → 一個 **nag > 0、已成功送過一次、
  之後某輪全失敗**的 slot,`lastNotifiedAt` 停在舊的成功時間,
  `now - lastNotifiedAt >= nag` 從此**恆為 true** → 每分鐘打 push service。
- 無條件把 `max(nag, RETRY)` 套在所有通知決策 → **送成功後的 nag 也被拉長**,
  `nag < RETRY` 的排程間隔被偷偷改掉。
  **⚠️ 更正(QA 實測戳破的錯誤假設)**:原本以為「既有測試 `nag = 10` 會直接紅」——
  **不會**。`max(10, 10) = 10`,那條測試看不出差別;而唯一的 `nag = 5` 案例是
  「答覆後停止」,根本走不到間隔比較。所以這一格**必須另外補一條 `nag < RETRY`
  (用 5)的測試**才鎖得住。

**定案 —— 是三分支,不是兩分支**(第 2 輪 review 抓到:把 `no_subscriptions` 併進
「未送達」會讓它被節流 10 分鐘,直接弄紅既有測試「零訂閱一輪 → 60 秒後補訂閱 → 立刻送」):

| `lastSendOutcome` | 間隔 | 基準 |
|---|---|---|
| `'sent'` | `nagIntervalMinutes` | `lastNotifiedAt` |
| `'no_subscriptions'` | **無條件 due**(不比對任何間隔) | —(見 D12) |
| 其餘(`failed` / `expired`) | `max(nagIntervalMinutes, RETRY_INTERVAL_MINUTES)` | `lastAttemptAt` |

**另外兩個實作細節必須釘死,否則會安靜地壞掉**:

- **未送達分支不可沿用既有的 `nagIntervalMinutes > 0 &&` 閘門** —— 那個閘門的用途是
  「`nag = 0` 只送一次」,套在重試上會讓 **`nag = 0` 的失敗永遠不重試**。
- **`lastAttemptAt === null` 一律視為「該送」** —— 原本的首發條件是
  `lastNotifiedAt === null`,被取代之後若沒有這條 fallback,首次 materialize 會在
  `null.getTime()` 上拋,而且**會被 D8 的 `catch {}` 靜默吃掉**(正是本 change 要對付的
  那種無聲失敗)。

`RETRY_INTERVAL_MINUTES = 10`,與 `LOOKBACK_MINUTES` 放在同一處作為具名常數。
(選 10 的理由:大於既有的兩個 nag 值 5 / 10 之中較大者,不會讓「持續失敗」比正常 nag 還吵;
又小到能在一小時內重試數次。)

### D11a. rollout 要 backfill,否則上線當天會多送一次

`shouldNotify` 把 `lastAttemptAt === null` 當成「該送」(它取代了原本的
`lastNotifiedAt === null` 首發條件)。部署當下已 materialize 的舊列是
**`last_notified_at` 有值、`last_attempt_at` 為 NULL**,所以第一個 tick 會對**每個
未答覆的今日 slot 多送一次**,包含 `nag_interval_minutes = 0` 且當天已送過的 ——
直接牴觸 spec 的「A single-fire reminder is not repeated」。

**定案**:migration 尾端加一行 backfill
(`SET last_attempt_at = last_notified_at, last_send_outcome = 'sent',
last_send_detail = 'backfill' WHERE last_notified_at IS NOT NULL`)。deploy 流程會在
Deploy Worker **之前**跑 migration 且失敗即中止,所以順序是安全的。
`'sent'` 是**假設而非觀測**(舊程式碼只要有訂閱就寫 `last_notified_at`,未必真的送成功),
但標其他值會讓這些列落進 floor 分支而多送一次 —— 正是這條 backfill 要防的。
`last_send_detail = 'backfill'` 讓這個假設自我說明,零成本。

### D12. `no_subscriptions` **無條件 due**,且只在 outcome 變化時才寫

- **無條件 due(修正)**:一度寫成「不套 floor,但仍比對 `nagIntervalMinutes`」,
  那是**行為回退**。改動前零訂閱那輪什麼都不寫,`lastNotifiedAt` 保持 null,
  因此**每個 tick 都是 due** —— 使用者 09:01 才授權推播,09:00 那則 `nag = 10` 的提醒
  會**立刻**送出。加上間隔比對後,同一情境要等到 09:10。
  當時援引的既有測試(「零訂閱一輪 → 60 秒後補訂閱 → 立刻送」)用的是 **`nag = 0`**
  (`>= 0` 恆真),所以 `nag > 0` 從來沒被守到 —— 而「該收到卻沒收到」正是本 change
  要消滅的症狀,不能自己引入一個。**定案:`return true`**,恢復改動前的語意。
  成本與改動前完全相同:零訂閱時每 tick 一次 `subscriptionRepo.listByUser` 讀取,
  不多送推播、也不多寫 DB(下面的 skip-write guard 仍然擋住重複寫入)。
  鎖住的測試:「a zero-subscription slot delivers as soon as a subscription exists,
  even when nag > 0」。
- **只在 outcome 變化時才寫**:否則一個零訂閱的 due slot 會從「完全不寫 DB」變成
  **每分鐘一筆 UPDATE**(單一 slot 最壞約 1440 次/天,直到當地日結束),對 Neon 的
  compute 是實際成本。連續同樣的 `no_subscriptions` 只記第一次。
  **這條例外只適用於 `no_subscriptions`**:`failed` 必須每次都寫,因為 `lastAttemptAt`
  就是 retry floor 的量測基準,不寫會讓它凍結、floor 塌回成每 tick 重試(正是 D11 要
  防的 bug)。spec 的 scenario 已據此收窄措辭。

### D13. `expired` 視為**未送達**,並帶計數的 detail

- 整輪訂閱全部 `expired`(404/410,已被刪)→ **不**更新 `lastNotifiedAt`,
  `outcome` 記 `expired`、`detail` 記 `status_410`。
  這正是「使用者的瀏覽器訂閱早就失效」這個**最可能的真實情境**。
  **注意措辭**:`expired` 走的是 floor 分支,所以是「**下一次重試**(至少
  `RETRY_INTERVAL_MINUTES` 之後)才會落成 `no_subscriptions`」,不是「下一輪自然變成」——
  日後照這句話查 DB 才不會誤判。
- **多訂閱時 detail 帶該輪計數**:`sent=1 failed=2 status_401` 這種形式。
  多個失敗且 detail 不同時,**取該輪第一個失敗的 detail**(規則要釘死,否則實作與測試
  各自解讀)。長度與敏感資料沒有疑慮:欄位是 `text` 無上限,而 `WebPushSender.clean()`
  已把 endpoint 換成 `<endpoint>` 並截到 120 字。
  **為什麼要帶計數**:否則「兩個裝置、一個成功一個失敗」會記成 `sent`,資料上看不出
  「手機那台一直失敗」—— 而那恰恰是使用者抱怨的情況。成本幾乎為零,對可診斷性的提升
  遠大於單一字串。
- **全部成功 → `detail = null`**(不論幾個訂閱):`WHERE last_send_detail IS NOT NULL`
  是本 change 唯一的 triage 查詢,健康的多裝置列若寫成 `sent=2` 就會混進去,把那個查詢
  廢掉。計數只在該輪**有** `failed`/`expired` 時才寫。
- **不存端點或金鑰**:只存 `WebPushSender` 已經 `clean()` 過的短診斷。

## 這個 change 的極限(誠實說明)

新欄位能區分的是「**根本沒送出去**」vs「**sender 說 OK**」,**不能證明裝置有顯示**。
如果真實原因是 push service 回 201 但通知沒跳(訂閱在瀏覽器端已失效卻不回 404/410、
iOS PWA 的限制、service worker 沒 `showNotification`),outcome 仍會記成 `sent` ——
資料更好看,使用者照樣收不到。

**下一步的診斷手段**(不在本 change):client 端 ack,或把 outcome 記到
`push_subscription` 上做 per-device 追蹤。

**部署後第一個該查的**:`.github/workflows/deploy.yml` 的 `secrets:` 只上傳
`DATABASE_URL` / `FIREBASE_PROJECT_ID`,**`VAPID_*` 是手動 `wrangler secret put` 的** ——
會漂移而無人察覺。這正是本 change 會以 `no_vapid_config` 現形的失效模式。

## 不動

- `WebPushSender`(outcome/detail 已經夠用,只是沒人接)。
- `runCareTick` 的 per-schedule `catch {}` 隔離(D8 的設計,改它是另一個題目)。
- 前端(這些欄位目前只給 SQL 診斷用,不上 API)。
