# Tasks

## 1. Schema 與 migration

- [x] 1.1 `src/shared/db/schema.ts` 加 `finance_budget`(partial unique ×2)與 `finance_budget_alert`(`(budget_id, month, threshold)` unique、budget cascade delete),`npm run db:generate`,`npm run typecheck` 過。

## 2. Domain + application(重要邏輯,測試必須覆蓋;unit 層 fake repository)

- [x] 2.1 `domain/`:`FinanceBudget` 實體、`FinanceBudgetRepository` port(upsert/delete/list、spent 彙總查詢、`tryRecordAlert`(存在→false,插入成功→true;adapter 照 drizzle-care-log-repository 先例用 `onConflictDoNothing().returning()` 看回列))、`BudgetAlertNotifier` port、`FinanceBudgetNotFound`。
- [x] 2.2 `application/upsert-budget.ts` / `delete-budget.ts`:驗證(amount 正整數;category 存在/同 user/expense/未 archived;總額 category_id=null)、upsert 語意、他人/不存在 404。測試:各驗證分支、user 隔離。
- [x] 2.3 `application/list-budgets-with-progress.ts`:month 驗證、spent/remaining/percent(僅 TWD expense;總額=全部、分類=該分類)。測試:範圍正確、外幣不計、負 remaining。
- [x] 2.4 `application/check-budget-alerts.ts`:受影響預算(總額+交易分類;update 跨分類含新舊;注入 `FinanceCategoryRepository` 取分類名供文案)、交易 `day` 所在月、80/100 兩線、`tryRecordAlert` 成功才 notify、單筆跨兩線推兩則、非 TWD/income 不觸發、notifier 拋錯吞掉(log)不外洩。測試:spec 六個 scenario 全對應+併發去重(fake 模擬 conflict)。
- [x] 2.5 `create-transaction.ts` / `update-transaction.ts` 注入並在成功後呼叫 2.4(best-effort try/catch)。測試:寫入成功+檢查被呼叫、檢查拋錯不影響回應、delete 不觸發。

## 3. Adapters + HTTP

- [ ] 3.1 `adapters/drizzle-finance-budget-repository.ts`(spent SQL 彙總 bigint cast;`tryRecordAlert` 用 `onConflictDoNothing().returning()` 看回列判斷;update 顯式 updatedAt)。
- [ ] 3.2 `adapters/push-budget-alert-notifier.ts`:包 notifications 的 `PushSender`+`PushSubscriptionRepository`(照 send-test-push 慣例:expired 訂閱刪除、失敗計數);文案照 design(80/100 兩款,總額/分類兩式,不含金額)。
- [ ] 3.3 `routes/finance.ts` +3 handlers(GET/PUT/DELETE budgets);`app.ts` 掛、`index.ts` 組線(組合 notifier)。
- [ ] 3.4 route 測試(workers vitest 注入 fake):三 endpoint 401/400/404/happy、GET 進度形狀。

## 4. 收尾

- [ ] 4.1 `npm test` + `npm run typecheck` 全綠;migration 已 commit。
