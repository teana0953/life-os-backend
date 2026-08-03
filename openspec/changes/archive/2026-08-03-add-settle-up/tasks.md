# Tasks

由內而外。授權每一格都要有「非參與者拿到 404」的反向測試(沿用分帳那期的紀律)。

## 1. Schema + migration

- [x] 1.1 `split_settlement`:`id`、`group_id` **nullable** → `expense_group.id`、`from_user_id`/`to_user_id` → `users.id`、`amount` integer、`currency`、`day` date、`note` nullable、`created_by_user_id`、時間戳
- [x] 1.2 CHECK `amount > 0`;**CHECK `from_user_id <> to_user_id`**(自己付給自己不是還款);index `(from_user_id)`、`(to_user_id)`、`(group_id)`
- [x] 1.3 `npx drizzle-kit generate` 產 migration 並 commit;**不要手寫 SQL**

## 2. domain

- [x] 2.1 `Settlement` 實體 + `SettlementRepository` port(create/listForUser/findById/delete)
- [x] 2.2 errors:重用 `SplitNotFound` 等既有 typed error,新增 `CannotSettleWithSelf`
- [x] 2.3 **兩段餘額的正負號各自抽成純函式並各自測試**,並且**把這兩支函式當成符號規則的唯一正本**:兩段 CTE 的加減號要照抄自它們,並在 SQL 旁邊寫註解指回函式名。**要誠實看待這件事的極限**——SQL 不會呼叫這兩支函式,測它們只證明函式本身對,不證明手寫的 CTE 跟它一致。CI 裡沒有任何東西能證明後者(見 4.4),真正的驗證只有實機。**兩者的符號約定相反**:
  - 雙人:列主體是**對方**,正 = 對方欠我 → `對方 → 我` 的還款**減**、`我 → 對方` **加**
  - 群組:列主體是**成員自己**(付款人 `+`、分擔人 `−`),正 = 該成員是債權人 → `成員 → 別人` **加**、`別人 → 成員` **減**
  共用一個函式會讓群組那邊反向:欠款人還完錢顯示欠更多,不報錯
- [x] 2.3b 測試**對指名成員斷言有號數值**,不是靠零和:B 欠 A 450、B 還 A 450 → A 的 net 0、B 的 net 0;B 只還 300 → A 是 +150、B 是 −150。**零和不能當方向檢查**——加減號整組對調,零和照樣成立、測試照樣綠

## 3. application

- [x] 3.1 `createSettlement`:驗金額>0 且 ≤ `MAX_MINOR_UNITS`(既有共用常數,**不要再寫死一次**)、幣別、day、`from != to`、**呼叫者必須是 from 或 to 之一**(不能幫別人記還款,同分帳的反偽造規則)、對方是好友或同群組成員、群組還款雙方都是成員、群組未封存
- [x] 3.2 `listSettlements`(篩選語意與支出一致:`group_id=` / `with=` / 皆無)、`deleteSettlement`(限 `created_by_user_id` 或 `from_user_id`,其他人 → `SplitNotFound`)
- [x] 3.3 **`listSettlements` 也要在查詢之上逐列斷言參與資格**(與 `listExpenses` 同一條理由:SQL 在 CI 測不到,而這是整批洩漏的路徑)
- [x] 3.4 `getSplitSpending(userId, month)`:`Σ split_share.amount WHERE user_id = me AND expense.day 落在該月`,按幣別——**幣別在 `split_expense` 上,`split_share` 沒有這欄**,所以要 join;月份篩選照既有 `to_char(day, 'YYYY-MM')` 的先例。**付款人自己那份要算**(他確實花了);**還款不算**(結清不是新花費)。這兩點與餘額計算的規則相反,要寫在註解裡,否則下一個人會以為其中一邊是 bug
- [x] 3.5 測試:in-memory repository,每個 use case 正向 + 每條授權規則反向;還款金額超過欠款會讓餘額翻向另一邊(多還是真實情況,不擋)

## 4. adapters

- [x] 4.1 `drizzle-settlement-repository.ts`。**單列插入,不需要 `db.batch`**(沒有 expense/shares 那種多列不變量)
- [x] 4.2 `drizzle-balance-repository.ts` 的**兩段 CTE 都要加還款**。**雙人那段不加 `group_id` 篩選**(它本來就把有群組與無群組的支出一起算,還款腿也必須涵蓋全部);群組那段只算該群組的還款,**各自照自己那支純函式的符號**(2.3——兩者相反);群組那段加完零和仍要成立,但零和只是健全性檢查、不是方向檢查
- [x] 4.3 `getSplitSpending` 的 SQL 聚合(`GROUP BY` 幣別),不得把 share 全撈進記憶體
- [x] 4.4 測試:`listSettlements` 的參與條件寫進 SQL WHERE;**已知缺口**:餘額 CTE 與 spending 聚合無法在 CI 驗證(假 `Db` 丟掉 `where()` 參數,兩個 Vitest project 都沒有 Postgres 路徑)。緩解 = 2.3/2.3b 的兩支純函式與有號數值斷言 + 3.3 的應用層斷言,並在 PR 寫明留待實機——那是唯一能真的證明 SQL 方向沒寫反的地方

## 5. HTTP

- [x] 5.1 `POST`/`GET`/`DELETE /api/split/settlements`(**不做 PATCH**:三個欄位,記錯刪掉重記比部分更新單純,也少一條要重跑全部驗證的路徑)
- [x] 5.2 `GET /api/finance/split-spending?month=`,回應形狀 `{ month, totals: [{ currency, amount }] }`——照既有 summary handler 的 `{ month, totals: [...] }` 慣例;沒有分帳的月份回空陣列,不是每個幣別一列 0
- [x] 5.3 錯誤映射走既有 `mapSplitError`,新增 `CannotSettleWithSelf`;可見性一律 **404 不是 403**;所有 `:id` 與 body 內 user id 先過 `UUID_RE`(路徑 → 404,body → 400),不擋會打到 Postgres uuid cast 變 500
- [x] 5.4 三條 settlement 路由註冊在 expense 路由旁邊;**沒有順序衝突**(與 `/api/split/expenses/:id` 不共用參數化前綴)。既有註解講的是 `:id` 與同層字面路徑的衝突,這裡不適用
- [x] 5.5 `src/index.ts` DI 接線
- [x] 5.6 **`/api/finance/summary` 的回應形狀不得改動**——既有前端已在讀它;分帳自付額走新 endpoint。加一條測試釘住 summary 在有分帳資料時完全不變
- [x] 5.7 測試:每條 endpoint 的 happy path、401、非參與者 404

## 6. 預算不受影響

- [x] 6.1 確認 `checkBudgetAlerts` 仍只在 `createTransaction` 觸發,分帳與還款都不觸發
- [x] 6.2 測試:使用者在該月有 TWD 分帳份額時,每個預算的 `spent` 完全不變、也不發推播

## 7. 收尾

- [x] 7.1 `npm run typecheck`、`npm test` 全綠
- [x] 7.2 grep 確認沒有任何 settlement 端點回 403,也沒有 not-found 路徑落到 `onError` 的 500
