# Tasks

**這個 change 的賣點是一致性,所以每個守門都要能抓到「兩邊對不上」。**

而**測得到的前提是鏡像在應用層算**(D2)。第一版把它放在 adapter 裡,結果 `finance.test.ts` 用的是 `InMemorySplitExpenseRepository`(`fakes.ts:120`,`create` 只做 `rows.push`),**HTTP 層看不到任何鏡像**,底下十幾個守門一個都寫不出來。動手前先確認 D2 的形狀真的照做了。

## 0. 先決定,再動手

- [ ] 0.1 `split-into-budget` 已刪除。確認 repo 裡沒有殘留的 `SplitSpentLookup`、`includes_split`。
- [ ] 0.2 **數 `select count(*) from split_expense`**(D14)。是 0 就把第 10 節整段砍掉並寫進 PR;不是 0 就照第 10 節做。**要真的數,不要憑印象。**

## 1. 分帳加分類欄位(D1)—— 這是新功能,不是接線

- [ ] 1.1 `split_expense.category_name text null`。**存名字不存 id**(分類是 per-user 的)。
- [ ] 1.2 `CreateExpenseInput`/`UpdateExpenseInput`、`validateExpenseFields`、`POST`/`PUT /api/split/expenses`、`GET` 的回應都要帶。
- [ ] 1.3 **前端契約改動**:分帳建立表單要多一個分類選擇。前端在另一個 repo,**寫進 PR**,不要以為後端加完就結束。

## 2. `SharesMirror` port(D2)

- [ ] 2.1 `src/contexts/split/domain/shares-mirror.ts` 定義 `plan()` 與 `afterWrite()`。**port 在 split 的 domain,實作在 finance 那側** —— 依賴方向 finance → split,`src/contexts/split/` 不 import 任何 `contexts/finance/`。
- [ ] 2.2 `SplitExpenseRepository.create/update` 簽章收一組鏡像列。**repository 不算鏡像,只把拿到的列放進 batch。**
- [ ] 2.3 `createExpense`/`updateExpense` 應用層呼叫 `plan`,寫入成功後呼叫 `afterWrite`。
- [ ] 2.4 **突變:讓 repository 自己算鏡像(忽略傳進來的那組)**,3.x 的分類解析測試必須紅。這條擋的是「又滑回 adapter 層」。
- [ ] 2.5 **`finance.test.ts` 的 `buildApp` 要接真的 `FinanceSharesMirror`**(配既有的 in-memory finance repository),**不要**接一個回固定值的 fake。接了 fake,3.x 全部變成不可能失敗。

## 3. 分類解析(D4)

- [ ] 3.1 同名 `type='expense'` → 「其他」`type='expense'` → 一個分類都沒有就先 seed 再回第 2 步。
- [ ] 3.2 **突變:拿掉 seed 那一步**,一個「參與者從沒開過記帳頁」的 fixture 必須紅。fixture 要真的讓那個使用者**一個分類都沒有** —— **不能先呼叫 `GET /api/finance/categories`**,那會把他 seed 掉,測試就永遠綠。
- [ ] 3.3 **突變:名字解析不限定 `type`**,一個「使用者同時有 expense 與 income 的『其他』」的 fixture 必須紅。斷言鏡像的 `category_id` **等於 expense 那個的 id** —— 只斷言「有一個分類」的話,挑到 income 的突變會活下來。
- [ ] 3.4 **突變:改用付款人的 `category_id`**,一個「兩人分類 id 不同但同名」的 fixture 必須紅。**斷言方式只能是「鏡像的 `category_id` 等於分攤者自己那個 id」** —— 不要斷言「寫入失敗」:`finance_transaction.category_id` **沒有**任何把它綁到同一個 `user_id` 的約束,付款人的 id 存在,插入會成功,只是把錢記到別人的分類上。
- [ ] 3.5 封存分類:鏡像照用。**測試同時斷言 `POST /api/finance/transactions` 選同一個分類仍然被拒**(`create-transaction.ts:28`)—— 只斷言前半的話,「乾脆把 create 的封存檢查拿掉」這個突變會活下來。兩件事都在 HTTP 層,同一條測試寫得出來。

## 4. 不覆蓋使用者改過的分類(D6)

- [ ] 4.1 更新寫成 `INSERT … ON CONFLICT (user_id, split_expense_id) DO UPDATE`,只在 `category_source = 'mirror'` 時覆寫 `category_id`。
- [ ] 4.2 **不要沿用 share 的「刪光再插」**(`drizzle-split-expense-repository.ts:185-186`)。那會炸掉 `category_source='manual'`,而且會讓 5.3 的唯一索引守門變成不可能失敗。
- [ ] 4.3 **突變:無條件覆寫 `category_id`**,一條「使用者改分類 → 付款人改金額 → **分類不變且金額有變**」的測試必須紅。**金額那半一定要斷言** —— 少了它,「乾脆什麼都不更新」這個突變會活下來。

## 5. Schema(D5)

- [ ] 5.1 `finance_transaction.split_expense_id uuid null references split_expense(id) on delete cascade`。
- [ ] 5.2 `finance_transaction.category_source text not null default 'manual'`。
- [ ] 5.3 部分唯一索引 `(user_id, split_expense_id) where split_expense_id is not null`。**突變:拿掉索引**,一條「同一筆分帳連續編輯兩次,分攤者的交易數量仍然是 1」的 PGlite 測試必須紅。**這條只在 4.1 用 upsert 時才有意義**;若寫成刪光再插,拿掉索引什麼都不會變,守門是死的。
- [ ] 5.4 移除的分攤者:batch 裡帶 `delete … where split_expense_id = ? and user_id not in (…)`。**集合式的,不需要知道編輯前是誰** —— adapter 刻意不讀 grouped expense 的舊分攤者(`:182-183`),那個最佳化不該為這個 change 死掉。
- [ ] 5.5 **突變:拿掉那條 delete**,一條「grouped expense 移除一個分攤者後,他的交易不見了」的測試必須紅。**fixture 要用 grouped 的** —— 用 groupless 的話,舊分攤者剛好被別的程式碼讀到,突變可能活下來。
- [ ] 5.6 刪除分帳靠 `on delete cascade`,**不在 batch 裡另外刪**(`delete` 是單一 `db.delete(splitExpense)`)。

## 6. 警示(D2、#76)

- [ ] 6.1 `afterWrite` 對每個鏡像跑 `checkBudgetAlerts`,**盡力而為**:丟錯不影響分帳寫入(比照 `create-transaction.ts:41`)。
- [ ] 6.2 **突變:拿掉 `afterWrite` 呼叫**,一條「分帳讓分攤者跨過 80% → `FakeBudgetAlertNotifier` 收到一則」的測試必須紅。**fixture 的自付額要真的跨過門檻** —— 分帳總額 1800 平分是自付 900,對 1000 的預算是 90%;拿 900 平分(自付 450)是 45%,那樣寫的話突變會活下來。
- [ ] 6.3 **突變:把 `afterWrite` 的錯誤往外丟**,一條「notifier 丟錯但分帳仍然 200 且鏡像仍然存在」的測試必須紅。
- [ ] 6.4 既有的「同一個 (budget, month, threshold) 永不重複通知」不能被破壞。

## 7. 半唯讀(D7)

- [ ] 7.1 `split_expense_id is not null` 的交易:`DELETE` 一律拒絕;`PUT` **只在 amount/date/currency 的值真的不同時**拒絕。
- [ ] 7.2 **`PUT` 是全取代**,只改分類的客戶端一定會重送 amount/currency/date。**「帶了就拒絕」會讓唯一允許的編輯做不到。** 比較前要正規化 currency 大小寫與日期形式。
- [ ] 7.3 改分類時把 `category_source` 設成 `'manual'`。
- [ ] 7.4 **在後端擋** —— 前端在另一個 repo,API 是公開的。
- [ ] 7.5 **突變:只擋 delete 不擋 update**(以及反過來),兩個方向各要有一條測試紅。
- [ ] 7.6 **突變:改成「帶了 amount 就拒絕」**,一條「重送相同的 amount/date/currency 只改分類 → 200」的測試必須紅。
- [ ] 7.7 回應要標明這筆來自分帳(`GET` 列表也要),讓前端能把欄位鎖起來。

## 8. 零元分攤、結清、墊錢(D8、D9)

- [ ] 8.1 零元分攤**不產生鏡像**。split 允許零元(`validate-expense-fields.ts:97-99`,CHECK 是 `amount >= 0`),finance 要求 `amount > 0`,而 `finance_transaction.amount` **沒有 CHECK** —— 繞過應用層就會靜默寫進一筆 0 元交易。
- [ ] 8.2 **突變:零元也產生鏡像**,一條「三人分攤其中一人 0 元 → 只有兩筆交易」的測試必須紅。
- [ ] 8.3 墊錢但沒分攤的付款人不產生鏡像。**突變:付款人拿全額鏡像**,一條「A 付 1800、A 分攤 900 → A 的交易是 900」的測試必須紅。
- [ ] 8.4 結清不產生鏡像。**這條不寫突變測試** —— 結清由完全不同的 repository 寫(`create-settlement.ts`),這個 change 一行都沒碰它,沒有任何**對這個 change 的**突變能讓它產生鏡像。寫一條「結清後交易數量不變」的斷言當回歸即可,**不要謊稱它有突變驗證**。

## 9. 白名單外的幣別(D10、D11)

- [ ] 9.1 白名單外不產生鏡像,**分帳本身照樣寫成功**。
- [ ] 9.2 **突變:白名單外整筆失敗**,一條 THB 分帳的測試必須紅。
- [ ] 9.3 `GET /api/finance/split-spending` 每個幣別標明是否已計入交易。**突變:標記寫死成同一個值**,一條**同時有 TWD 與 THB 分帳**的測試必須紅 —— 只測一種幣別的話常數會活下來。

## 10. 回填(**只在 0.2 數出來不是 0 時才做**)

- [ ] 10.1 **不能寫成 migration。** `drizzle/*.sql` 拿不到 `SharesMirror`、拿不到任何 JS。要做就是一支一次性腳本走 D2 的 `plan`。
- [ ] 10.2 **不呼叫 `afterWrite`** —— 否則一次噴出一堆歷史通知。**這條沒有突變測試**:腳本只跑一次、沒有測試會再跑到它。**用 code review 擋,並在 PR 裡明說它只有 review 擋著。**
- [ ] 10.3 白名單外幣別、零元分攤跳過。
- [ ] 10.4 可重跑(唯一索引擋重複)。PR 裡寫明使用者會看到過去月份的數字變高。

## 11. `test/db` 要先接起來(D15)

- [ ] 11.1 `harness.ts:116` 的 `TABLES` **一張 finance 表都沒有**,`test/db/` 下沒有建構過任何 finance repository。原子性、upsert、cascade、唯一索引的守門**全部需要先接這條路**。
- [ ] 11.2 原子性測試用 `withBatchShim`(`harness.ts:100-114`,真的 Postgres 原子性,rollback 被 `harness-batch.test.ts` 釘住)。
- [ ] 11.3 **原子性的突變要有可注入的失效點**:讓 `plan` 回一列帶著不存在的 `category_id`,batch 就會 FK 失敗。**沒有這個縫,2.x 的原子性守門寫不出來** —— 分類解析在 batch 之前跑、對的是真的資料列,而 PGlite 是單一連線,沒有東西能在中途把分類刪掉。
- [ ] 11.4 **突變:把鏡像從 batch 搬到 batch 之後用第二次 await 寫**,11.3 的失效點必須讓「分帳存在但鏡像不存在」紅。

## 12. 別人會動你的帳本(D13)

- [ ] 12.1 付款人刪分帳 → cascade **刪掉你帳本裡一筆真的交易**;付款人改金額 → 可能把你推過預算門檻並通知你。**寫進 PR 的 Impact。**
- [ ] 12.2 目前沒有任何通知路徑告訴你記帳頁發生了什麼(分帳動態有,記帳頁沒有)。**不在這個 change 做,開 issue。**

## 13. 驗證

- [ ] 13.1 `npm test`、`npm run typecheck` 全綠。
- [ ] 13.2 既有測試的反轉:`finance.test.ts:642`(summary 不受分帳影響)、`:807`(分帳不改變任何預算)。**這兩條只有在 2.5 把真的 `FinanceSharesMirror` 接進 `buildApp` 之後才會反轉** —— 若它們改完仍然綠,不是「沒影響」,是**接線沒接上**,回去看 2.5。
- [ ] 13.3 其餘因為「分帳現在會產生交易」而失敗的,逐條判斷是合法的預期變化還是真的弄壞了,不要用改斷言的方式繞過。
