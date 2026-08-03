## Why

一筆債可以**純粹透過共同群組產生**——兩個人同在一個旅行群組、彼此從沒加過好友,群組支出就讓其中一人欠另一人錢。但 `createSettlement` 在 `group_id = null` 時要求雙方是好友,所以這筆真實存在的債**沒有辦法結清**,前端只能把結清入口藏起來,並要使用者先跑一趟加好友流程。

參考 Splitwise 的做法:它沒有「先加好友才能互動」這道閘門——把人加進群組本身就建立了關係,群組成員就是可以分帳與結清的對象。使用者裁定照這套走。

## What Changes

- `ExpenseGroupRepository` 加 `shareAnyGroup(userId, otherUserId)`(成員表自我 join,`limit(1)`——這是述詞不是列表)。
- `createSettlement` 在 `group_id = null` 時改成「**是好友,或有共同群組**」。

**刻意比 `createExpense` 的無群組規則寬鬆**:那邊仍要求好友。你**不能**跟非好友的群組成員建立無群組支出,但**可以**結清一筆你已經有的債。差別的理由是債已經存在,擋住結清等於讓餘額永遠掛著。

## Capabilities

### Modified Capabilities

- `split-bills`:無群組還款的對象條件。

## Impact

- 修改 `src/contexts/split/domain/expense-group-repository.ts`、`adapters/drizzle-expense-group-repository.ts`、`application/create-settlement.ts` 與測試/假物件。
- 只放寬、不收緊,既有行為無破壞性變更。
