## Why

PR #67 讓每個 share 帶名字,但**付款人沒有**。`payer_user_id` 仍是裸 id,而付款人**不一定持有 share**——純代墊的情況下他完全不在 shares 裡,所以名字也推不出來。同一個洞往旁邊挪了一格:讀這筆支出的共同分擔人看不到是誰付的錢。

## What Changes

- `SplitExpense` 加 `payerDisplayName`,與 share 名字同一次 `users` 查詢解析(把 `payerUserId` 一起放進 `namesFor` 的輸入)。
- `expenseToJson` 加 `payer_display_name`。

回應形狀只增不減。

## Capabilities

### Modified Capabilities

- `split-bills`:支出帶付款人名字。

## Impact

- 修改 `src/contexts/split/domain/split-expense.ts`、`adapters/drizzle-split-expense-repository.ts`、`src/adapters/http/routes/split.ts` 與測試。
