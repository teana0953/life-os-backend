## Why

前一個 change(PR #66)只在群組成員上加了名字,理由是「群組支出的分擔人必然是群組成員、無群組支出的分擔人必然是呼叫者的好友,兩份來源就湊得齊」。**這個前提是錯的。**

`validate-expense-fields.ts` 只檢查**建立者**的好友關係,而 `participation.ts` 讓**每一個持有 share 的人**都能讀這筆支出。所以 A 建立一筆 A/B/C 三人分帳(B 與 C 都是 A 的好友,彼此不是),B 讀得到這筆支出、看得到 C 的 share,但 C 既不是 B 的好友、也不在任何跟 B 共同的群組裡——沒有任何端點能給 B 一個名字。三個人一次性分帳是最常見的情境,前端只能顯示佔位字串,而 C 是個真人。

## What Changes

- `SplitShare` 拆成兩型:`SplitShareInput`(寫入:`userId` + `amount`)與 `SplitShare`(讀出:多一個 `displayName`)。寫入路徑不需要名字,讀出路徑一定要。
- `DrizzleSplitExpenseRepository` 用一次 `users` 查詢解析整批結果的所有參與者(**不是 join**,那會讓 expense 列隨 share 數重複),create/update 回傳也帶上名字,讓寫入與讀取回應同形。
- `expenseToJson` 的每個 share 加 `display_name`。

回應形狀只增不減。

## Capabilities

### Modified Capabilities

- `split-bills`:支出的 share 帶名字。

## Impact

- 修改 `src/contexts/split/domain/split-expense.ts`、`split-calculator.ts`、`application/validate-expense-fields.ts`、`adapters/drizzle-split-expense-repository.ts`、`src/adapters/http/routes/split.ts` 與對應測試。
- 前端無破壞性變更。
