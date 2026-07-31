## Why

財務 sub-project 2。個人記帳(sub-project 1,PR #61/#110 已 merge)只能事後看統計——使用者要的預算功能(總設計已核:app 內顯示+超支 Web Push)還沒有。使用者已確認三個關鍵決策:總額+分類預算皆可、記帳當下跨線即推、預算只算 TWD。

## What Changes

- 新表 `finance_budget`(per-user 循環月預算:`category_id` null=總額、非 null=該 expense 分類;TWD 元整數;partial unique 一人一筆總額/一分類一筆)與 `finance_budget_alert`(`(budget_id, month, threshold)` unique,推播去重)。
- `/api/finance/budgets`:GET(含該月 spent/remaining/percent,SQL 彙總,僅計 TWD expense)、PUT(upsert)、DELETE。
- 寫入交易路徑 hook:create/update TWD expense 交易成功後檢查受影響預算(總額+該分類;update 跨分類算新舊),80%/100% 跨線且未告警過 → `onConflictDoNothing` 記錄+發 Web Push(既有 PushSender 基礎;失敗不影響交易;同月同線只推一次)。
- 跨 context 邊界:finance 定義 `BudgetAlertNotifier` port,adapters 包 notifications 的 push 元件,`index.ts` 組合——finance domain/application 不 import notifications。

範圍外:前端 UI(下一 loop)、每日摘要排程、外幣計入、預算逐月覆寫、告警回收。

## Capabilities

### New Capabilities

- `finance-budgets`:每月循環預算(總額+分類)、進度查詢、寫入時跨線(80/100)Web Push 告警與去重。

### Modified Capabilities

- `finance-ledger`:create/update transaction 成功後多一個 budget-alert 檢查副作用(交易寫入行為本身不變;推播 best-effort 失敗不影響回應)。

## Impact

- `src/shared/db/schema.ts` +2 表;新 migration。
- `src/contexts/finance/`:+budget domain/application/adapters;`create-transaction.ts`/`update-transaction.ts` 注入 alert 檢查。
- `src/adapters/http/routes/finance.ts` +3 handlers;`app.ts`/`index.ts` 接線。
- 既有 endpoint 行為零變更(僅新增副作用)。
