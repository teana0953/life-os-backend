## Why

使用者回報「排程的照護提醒不會送」,但**測試推播收得到**。直接查生產資料庫的結果是:
tick 完全正常 —— cron 活著(今天 08:00:06 準時 materialize)、每天的 occurrence 都在、
`last_notified_at` 都有值。也就是說,**資料看起來一切正常,而使用者收不到**。

根因是這段:

```ts
for (const subscription of subscriptions) {
  const result = await deps.pushSender.send(subscription, {...});
  if (result.outcome === "expired") { /* delete */ }   // 只處理 expired
}
if (subscriptions.length > 0) {
  await deps.careOccurrenceRepo.touchNotified(occurrence.id, now);  // ← 不看成敗
}
```

**`touchNotified` 只看「有沒有訂閱」,完全不看 send 是否成功。** 所以 VAPID 設定壞掉
(`no_vapid_config`)、網路錯誤(`network:…`)、push service 回 4xx/5xx(`status_XXX`)——
**一封都沒送出去,`last_notified_at` 照樣被寫上**,而且 nag 還被推遲一個 interval。
`WebPushSender` 明明產出了具體的 `detail`,**卻被整段丟棄**,沒有任何地方留下痕跡。

後果有兩層:
1. **功能**:全數失敗的一輪被當成「已通知」,nag 不會立刻重試 —— 而 nag 正是這個設計用來
   對抗單次送達失敗的機制。
2. **可診斷性**:`last_notified_at` 同時代表「送成功了」與「試過但全失敗」,兩者無法分辨。
   加上 `runCareTick` 每個 schedule 的 `catch {}`(D8 的隔離設計)完全靜默,線上只剩
   「使用者說收不到」這一個訊號 —— 這次診斷就是靠直接查生產 DB 才推進的。

專案沒有付費的 log 產品可用,所以**可觀測性必須落在資料裡**。

## What Changes

- **`care_occurrence` 新增三個欄位**(migration):
  - `last_attempt_at`:**每次**嘗試投遞都寫(不論成敗)。
  - `last_send_outcome`:最後一次那一輪的彙總結果 —— `sent` / `failed` / `expired` /
    `no_subscriptions`。
  - `last_send_detail`:失敗時 sender 回的 `detail`(如 `status_413`、`no_vapid_config`);
    成功為 `null`。**只存 sender 已經清理過的短診斷字串,不含端點或金鑰。**
- **`last_notified_at` 的語意收緊成「至少一封真的送成功」**(design D10):一輪裡任一
  訂閱 `outcome === "sent"` 才更新。**部分成功算成功**(使用者已經收到了)。
- **全數失敗時不更新 `last_notified_at`** → 下一次 tick 會重試,nag 機制真的發揮作用。
- **重試 floor 只在「上一輪送失敗」時生效**(design **D11**,是**三分支**,規則必須釘死):
  - `sent` → 間隔 `nagIntervalMinutes`、基準 `last_notified_at`(**維持既有語意**,
    `nag = 0` 仍是只送一次);
  - `no_subscriptions` → 間隔 `nagIntervalMinutes`、基準 `last_attempt_at`(**不套 floor**);
  - `failed` / `expired` → 間隔 `max(nagIntervalMinutes, RETRY_INTERVAL_MINUTES)`、
    基準 `last_attempt_at`。
  - **`RETRY_INTERVAL_MINUTES = 10`**,與 `LOOKBACK_MINUTES` 放同一處作為具名常數。
  - 兩個易錯點:未送達分支**不可**沿用既有的 `nagIntervalMinutes > 0 &&` 閘門
    (會讓 `nag = 0` 的失敗永不重試);`last_attempt_at === null` **一律視為該送**
    (否則首次 materialize 會在 `null.getTime()` 上拋,還被 D8 的 `catch {}` 吞掉)。
- **`no_subscriptions` 不套 floor,且只在 outcome 變化時才寫**(design D12):
  不套 floor 是為了維持既有語意與既有測試(「零訂閱一輪 → 60 秒後補上訂閱 → 立刻送出」);
  只在變化時寫是為了避免零訂閱的 due slot 從「完全不寫 DB」變成**每分鐘一筆 UPDATE**
  (單一 slot 最壞約 1440 次/天)。
- **`expired` 視為未送達**(design D13):整輪全 expired(404/410,已被刪)→ 不更新
  `last_notified_at`,`outcome` 記 `expired`;**下一次重試**(至少 `RETRY_INTERVAL_MINUTES`
  之後)才會落成 `no_subscriptions`。
  這正是「瀏覽器訂閱早就失效」這個**最可能的真實情境**。
- **多訂閱時 `detail` 帶該輪計數**(如 `sent=1 failed=2 status_401`):否則「兩個裝置、
  一個成功一個失敗」會記成 `sent`,資料上看不出「手機那台一直失敗」—— 而那恰恰是
  使用者抱怨的情況。

## Impact

- Affected specs: `care-reminders`(MODIFIED:「Deliver and re-nag due reminders until answered」)
- Affected code: `src/shared/db/schema.ts` + 一支 migration、
  `src/contexts/notifications/domain/care-occurrence.ts`(port)、
  `src/contexts/notifications/adapters/drizzle-care-occurrence-repository.ts`、
  `src/contexts/notifications/application/run-care-tick.ts`
- **不動**:`WebPushSender`(它的 outcome/detail 已經夠用,只是沒人接);
  `runCareTick` 的 per-schedule `catch {}` 隔離(D8 的設計,改它是另一個題目);
  前端(這些欄位目前只給 SQL 診斷用,不上 API)。
- **無破壞性**:三個欄位皆 nullable,既有列不需要回填。

## 這個 change 的極限(誠實說明)

新欄位能區分的是「**根本沒送出去**」vs「**sender 說 OK**」,**不能證明裝置有顯示**。
若真實原因是 push service 回 201 但通知沒跳(訂閱在瀏覽器端已失效卻不回 404/410、
iOS PWA 限制、SW 沒 `showNotification`),outcome 仍會記成 `sent` —— 資料更好看,
使用者照樣收不到。下一步的診斷手段(不在本 change):client 端 ack,或把 outcome 記到
`push_subscription` 做 per-device 追蹤。

**部署後第一個該查的**:`deploy.yml` 的 `secrets:` 只上傳 `DATABASE_URL` /
`FIREBASE_PROJECT_ID`,**`VAPID_*` 是手動 `wrangler secret put` 的**,會漂移而無人察覺
—— 那正是本 change 會以 `no_vapid_config` 現形的失效模式。
