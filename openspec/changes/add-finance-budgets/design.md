# Finance Budgets(後端)— 設計

財務 sub-project 2:預算+超支推播。前置:sub-project 1 已 merge(`finance_category`/`finance_transaction`、`/api/finance/*`)。使用者已確認:總額+分類預算皆可、記帳當下跨線即推、預算只算 TWD。

## 目標

per-user 每月循環預算(總額一筆 + 各支出分類各一筆,皆可不設),TWD only;寫入交易當下檢查 80%/100% 兩線,跨線即發 Web Push(既有推播基礎),同月同線只推一次。

## 範圍外

前端 UI(下一個 loop)、每日排程摘要、外幣計入預算、預算歷史/逐月覆寫(預算是「循環設定」,改了就從當下生效)、告警回收(刪交易退回線下不撤已發通知)。

## 資料模型(照 repo pgTable 慣例)

### `finance_budget`

- `id` uuid pk defaultRandom
- `user_id` uuid not null → `users.id`
- `category_id` uuid nullable → `finance_category.id`(**null = 每月總額預算**;非 null 限 expense 分類)
- `amount` integer not null(TWD 元,> 0)
- `created_at` / `updated_at` timestamptz(update 顯式 set updatedAt)
- 唯一性:partial unique index `(user_id, category_id) WHERE category_id IS NOT NULL` + partial unique index `(user_id) WHERE category_id IS NULL`(一人一筆總額)

### `finance_budget_alert`(推播去重)

- `id` uuid pk defaultRandom
- `user_id` uuid not null
- `budget_id` uuid not null → `finance_budget.id`(cascade delete)
- `month` text not null(`YYYY-MM`)
- `threshold` integer not null(80 | 100)
- `created_at` timestamptz
- unique `(budget_id, month, threshold)`;插入 `onConflictDoNothing`,插入成功才發推播(併發下也只推一次)

## API

```
GET    /api/finance/budgets?month=YYYY-MM   # 全部預算+該月進度
PUT    /api/finance/budgets                 # upsert 一筆:{ category_id|null, amount }
DELETE /api/finance/budgets/:id
```

- GET 回傳:`{ month, budgets: [{ id, category_id, amount, spent, remaining, percent }] }`——`spent` = 該月該範圍(總額=全部;分類=該分類)**TWD expense** 合計(SQL 彙總);外幣交易不計。
- PUT upsert 語意(有就改金額,沒有就建);`amount` 正整數;`category_id` 非 null 時必須存在、屬同 user、type=expense、未 archived → 否則 400/404。
- DELETE:他人/不存在 → 404。刪預算 cascade 刪其 alert 記錄。

## 跨線推播(寫入路徑 hook)

`createTransaction` / `updateTransaction` 成功後(且交易為 TWD expense;update 含改金額/分類/日期/幣別任何影響進度的變更):

1. 取該交易 `day` 所在月 `month`(交易月,不是「今天」——補記過去月的交易照樣檢查該月)。
2. 找受影響預算:總額預算 + 該交易分類的分類預算(update 跨分類時新舊分類都算受影響)。
3. 對每筆受影響預算算 `spent`(SQL),對 80、100 兩線判定(**level-triggered + 月度去重**,不是嚴格「向上跨越」:只要當下 spent 達線且該 (budget, month, threshold) 從未告警過就告警——預算後設、spent 早已在線上的情況也會補告警一次;比較式在 application 層用整數運算 `spent * 100 >= amount * threshold`,不下放 SQL 免整數截斷)→ `tryRecordAlert` 插入成功才發推播。
4. 推播失敗不影響交易寫入(交易已成功;推播 best-effort,失敗 log 即可;`expired` 訂閱照 send-test-push 慣例刪除)。告警檢查+推播在 use case 內 `await`(接受少量回應延遲;Workers `waitUntil` 需把 executionCtx 穿進 use case,複雜度不值——量級是單使用者記帳,不是熱路徑)。
5. delete 交易不觸發檢查、不撤告警。

### 推播訊息

照 `send-test-push.ts` 的 `PushSender`/`PushSubscriptionRepository` port 慣例。文案(不含金額細節以外的個資):
- 80:`{title: "預算提醒", body: "7月餐飲支出已達預算 8 成"}`(總額版:「7月支出已達預算 8 成」)
- 100:`{title: "預算超支", body: "7月餐飲支出已超過預算"}`
月份/分類名代入;body 不含金額(隱私慣例從寬——金額屬敏感,沿用測試推播「無個資」精神)。

### 跨 context 邊界

finance 不 import notifications:`finance/domain` 定義 `BudgetAlertNotifier` port(`notify(userId, message)`);`finance/adapters` 提供 `PushBudgetAlertNotifier` 包 notifications 的 `PushSender`+`PushSubscriptionRepository`(組合在 `index.ts` 完成,依賴方向合法:adapters 可跨 context 組合)。

## 架構落點

- `domain/`:`FinanceBudget` 實體、`FinanceBudgetRepository` port(含 spent 彙總與 alert 的 tryRecordAlert)、`BudgetAlertNotifier` port、`FinanceBudgetNotFound` error。
- `application/`:`listBudgetsWithProgress`、`upsertBudget`、`deleteBudget`、`checkBudgetAlerts`(步驟 1–4;由 create/update transaction use case 成功後呼叫,注入進去)。
- `adapters/`:`DrizzleFinanceBudgetRepository`、`PushBudgetAlertNotifier`。
- HTTP:`routes/finance.ts` 加三 handler;`app.ts` 掛、`index.ts` 組線。
- Migration:`npm run db:generate`。

## 測試(重要邏輯必須覆蓋)

- upsert/delete/進度計算:happy、驗證(amount ≤0、income 分類、archived 分類、他人分類)、user 隔離、外幣不計入 spent、分類/總額 spent 範圍正確。
- checkBudgetAlerts:跨 80 推一次、同月重複寫入不再推、跨 100 再推一次、一筆同時跨兩線推兩則、update 改分類新舊預算都檢查、補記過去月按該月算、非 TWD/income 不觸發、推播失敗不炸交易、alert 併發去重(fake repository 模擬 conflict)。
- route:三 endpoint 的 401/404/400 + happy(workers vitest 注入 fake)。

## 驗收

`npm test` + `npm run typecheck` 全綠;alert 去重與跨線行為測試斷言與手算一致。
