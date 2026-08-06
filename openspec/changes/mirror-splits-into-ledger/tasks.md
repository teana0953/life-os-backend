# Tasks

**這個 change 的賣點是一致性,所以每個守門都要能抓到「兩邊對不上」。**

而**測得到的前提是鏡像在應用層算**(D2)。第一版把它放在 adapter 裡,結果 `finance.test.ts` 用的是 `InMemorySplitExpenseRepository`(`fakes.ts:120`,`create` 只做 `rows.push`),**HTTP 層看不到任何鏡像**,底下十幾個守門一個都寫不出來。動手前先確認 D2 的形狀真的照做了。

## 0. 先決定,再動手

- [ ] 0.1 `split-into-budget` 已刪除。確認 repo 裡沒有殘留的 `SplitSpentLookup`、`includes_split`。
- [ ] 0.2 **數 `select count(*) from split_expense`**(D14)。是 0 就把第 10 節整段砍掉並寫進 PR;不是 0 就照第 10 節做。**要真的數,不要憑印象。**

## 1. 分帳加分類欄位(D1)—— 這是新功能,不是接線

- [ ] 1.1 `split_expense.category_name text null`。**存名字不存 id**(分類是 per-user 的)。
- [ ] 1.2 `CreateExpenseInput`/`UpdateExpenseInput`、`validateExpenseFields`、`POST /api/split/expenses`、**`PATCH /api/split/expenses/:id`**(不是 PUT,`app.ts:478`)、`GET` 的回應都要帶。
- [ ] 1.3 **前端契約改動有三處**,全部寫進 PR:分帳建立表單多一個分類選擇;**每一筆交易的回應與列表都要帶「來自分帳」的標記**(前端才鎖得住欄位);**`GET /api/finance/split-spending` 每個幣別多一個「是否已計入交易」旗標**。前端在另一個 repo。

## 2. `SharesMirror` port(D2)

- [ ] 2.1 `src/contexts/split/domain/shares-mirror.ts` 定義 `MirrorPlanInput`、`ShareMirrorRow`、`plan()`、`afterWrite()`。**port 在 split 的 domain,實作在 finance 那側**;split 的 domain/application 不 import `contexts/finance/`。**split 的 adapter 會 import `shared/db/schema` 的 `financeTransaction`** —— 那是允許的,寫在註解裡。
- [ ] 2.2 `SplitExpenseRepository.create/update` 簽章收一組鏡像列。**repository 不算鏡像,只把拿到的列放進 batch。**
- [ ] 2.3 `createExpense`/`updateExpense` 呼叫 `plan`,寫入成功後呼叫 `afterWrite`。**`deleteExpense` 不呼叫**(刪除靠 cascade)。**`id` 要從 `deps.expenses.create({ id: crypto.randomUUID(), … })` 裡提出來**(`create-expense.ts:36`),`plan` 需要它。
- [ ] 2.4 **突變:把 `plan` 從應用層刪掉,改在 `DrizzleSplitExpenseRepository` 裡重新實作分類解析** —— 3.x 必須紅。(**不要**寫成「讓 repository 自己算」:3.x 走的是 `InMemorySplitExpenseRepository`,它沒有 `FinanceCategoryRepository`,算不出東西;而突變施加在 Drizzle 那個上,3.x 根本碰不到它。)
- [ ] 2.5 **`FinanceSharesMirror` 在 `createApp` 裡組**,用它已經持有的 `financeCategoryRepository` / `financeTransactionRepository`(`app.ts:191-192`)。**不要給 `CreateAppOptions` 加 `sharesMirror`** —— 有 22 個測試檔呼叫 `createApp`,而且 `finance.test.ts` 會傳 fake 進去,分類解析就變回不可測。
- [ ] 2.6 **`InMemorySplitExpenseRepository` 的建構子要收 `InMemoryFinanceTransactionRepository`,鏡像寫進去。** 它現在只有 `rows: SplitExpense[]`,而 finance 的端點讀的是**另一個物件**(`test/contexts/finance/fakes.ts:69`)。**fake 把鏡像存進自己的 list 的話,3.x/4.x/6.x/7.x/8.x/9.x 全部看不到鏡像** —— 那就是 D2 想修的問題往下搬一層。
- [ ] 2.7 波及面:`CreateExpenseDeps`(`create-expense.ts:8`,`updateExpense` 共用)、`routes/split.ts:421` 的兩個 handler、五個 split 應用層測試檔、`stubSplitExpenseRepository`(`split-stubs.ts:26`)。**逐個列出來改,不要邊做邊發現。**

## 3. 分類解析(D4)

- [ ] 3.1 同名 `type='expense'` → 「其他」`type='expense'` → 一個分類都沒有就先 seed 再回第 2 步。
- [ ] 3.2 **突變:拿掉 seed 那一步**,一個「參與者從沒開過記帳頁」的 fixture 必須紅。fixture 要真的讓那個使用者**一個分類都沒有** —— **不能先呼叫 `GET /api/finance/categories`**,那會把他 seed 掉,測試就永遠綠。
- [ ] 3.3 **突變:名字解析不限定 `type`**,一個「使用者同時有 expense 與 income 的『其他』」的 fixture 必須紅。斷言鏡像的 `category_id` **等於 expense 那個的 id** —— 只斷言「有一個分類」的話,挑到 income 的突變會活下來。
- [ ] 3.4 **突變:改用付款人的 `category_id`**,一個「兩人分類 id 不同但同名」的 fixture 必須紅。**斷言方式只能是「鏡像的 `category_id` 等於分攤者自己那個 id」** —— 不要斷言「寫入失敗」:`finance_transaction.category_id` **沒有**任何把它綁到同一個 `user_id` 的約束,付款人的 id 存在,插入會成功,只是把錢記到別人的分類上。
- [ ] 3.5 封存分類:鏡像照用。**測試同時斷言 `POST /api/finance/transactions` 選同一個分類仍然被拒**(`create-transaction.ts:28`)—— 只斷言前半的話,「乾脆把 create 的封存檢查拿掉」這個突變會活下來。兩件事都在 HTTP 層,同一條測試寫得出來。

## 4. 不覆蓋使用者改過的分類(D6)

- [ ] 4.1 更新寫成 `INSERT … ON CONFLICT (user_id, split_expense_id) DO UPDATE`,只在 `category_source = 'mirror'` 時覆寫 `category_id`。
- [ ] 4.2 **不要沿用 share 的「刪光再插」**(`drizzle-split-expense-repository.ts:185-186`)。那會炸掉 `category_source='manual'`,而且會讓 5.3 的唯一索引守門變成不可能失敗。
- [ ] 4.3 **這條在 `test/db`(PGlite),不在 HTTP 層。** 覆寫語意住在 `ON CONFLICT DO UPDATE` 的 SET 清單裡,HTTP 層施加突變只能改 in-memory fake —— 一個跟自己一致的 fake,證明不了生產的 SQL。
- [ ] 4.4 **突變:SET 清單裡的 `CASE` 改成無條件覆寫 `category_id`**,一條「使用者改分類 → 付款人改金額 → **分類不變且金額有變**」的 PGlite 測試必須紅。**金額那半一定要斷言** —— 少了它,「乾脆什麼都不更新」這個突變會活下來。
- [ ] 4.5 **`category_source` 的條件不能寫成 `DO UPDATE … WHERE`** —— 那會跳過整列,連 amount 都不更新。要寫成 SET 清單裡的 `CASE`。4.4 的金額斷言就是擋這個的。

## 5. Schema(D5)

- [ ] 5.1 `finance_transaction.split_expense_id uuid null references split_expense(id) on delete cascade`。
- [ ] 5.2 `finance_transaction.category_source text not null default 'manual'`。
- [ ] 5.3 部分唯一索引 `(user_id, split_expense_id) where split_expense_id is not null`。**突變:拿掉索引**,一條「同一筆分帳連續編輯兩次,分攤者的交易數量仍然是 1」的 PGlite 測試必須紅。**這條只在 4.1 用 upsert 時才有意義**;若寫成刪光再插,拿掉索引什麼都不會變,守門是死的。
- [ ] 5.4 移除的分攤者:batch 裡帶 `delete … where split_expense_id = ? and user_id not in (…)`。**集合式的,不需要知道編輯前是誰** —— adapter 刻意不讀 grouped expense 的舊分攤者(`:182-183`),那個最佳化不該為這個 change 死掉。鏡像集合為空時 `notInArray(col, [])` 在 drizzle-orm 0.45.2 產生 `true`,是安全的。
- [ ] 5.5 **這條也在 `test/db`(PGlite),理由同 4.3。突變:拿掉那條 delete**,一條「grouped expense 移除一個分攤者後,他的交易不見了」的測試必須紅。**fixture 要用 grouped 的**。
- [ ] 5.7 **batch 裡鏡像的 insert 必須排在 `expenseInsert` 之後**(FK 立即檢查)。這個 repo 對語句順序寫得很重(`:270`),照做。
- [ ] 5.6 刪除分帳靠 `on delete cascade`,**不在 batch 裡另外刪**(`delete` 是單一 `db.delete(splitExpense)`)。

## 6. 警示(D2、#76)

- [ ] 6.1 `afterWrite` 對每個鏡像跑 `checkBudgetAlerts`,**盡力而為**:丟錯不影響分帳寫入(比照 `create-transaction.ts:41`)。
- [ ] 6.2 **突變:拿掉 `afterWrite` 呼叫**,一條「分帳讓分攤者跨過 80% → `FakeBudgetAlertNotifier` 收到一則」的測試必須紅。兩個 fixture 條件都不能少:
  - **自付額要真的跨過門檻**:總額 1800 平分是自付 900,對 1000 的預算是 90%。拿 900 平分(自付 450)是 45%,突變會活下來。
  - **被通知的要是「不是寫入者」的那個分攤者**。#76 和 D13 講的就是這件事;拿付款人自己當受測對象是沒意思的那一半。
- [ ] 6.3 **突變:不 catch `afterWrite` 的錯誤**,一條「`afterWrite` 丟錯但分帳仍然 200 且鏡像仍然存在」的**應用層**測試必須紅,用一個會丟錯的 `SharesMirror` stub。
- [ ] 6.3a **不要用「notifier 丟錯」當那個突變** —— `check-budget-alerts.ts:65-69` **已經**把 notifier 的錯誤吞掉了(`try { notify } catch { console.error }`),所以會丟錯的 notifier **永遠不會讓 `afterWrite` 丟錯**,那個守門是死的。要丟錯就從 port 這一層丟。
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
- [ ] 8.2 **突變:零元也產生鏡像**,一條「三人分攤其中一人 0 元 → 只有兩筆交易」的測試必須紅。**fixture 必須用 `mode: "exact"`** —— 三人平分做不出零元(要 `amount < 3`,而那會被 `validate-expense-fields.ts:86-90` 直接擋掉)。而且 `createSplitExpenseBetween`(`finance.test.ts:305`)**只支援兩人**,要先寫一個三人的 helper。
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
- [ ] 12.3 **封存群組裡的分帳仍然可編輯**(`update-expense.ts:43` 傳 `checkArchived: false`,規格明說封存群組的支出保持可修正),所以封存群組裡的一次編輯照樣會動別人的帳本。**這是對的,但要寫出來**,否則會被當成漏洞。

## 13. 驗證

- [ ] 13.1 `npm test`、`npm run typecheck` 全綠。
- [ ] 13.2 既有測試的反轉:`finance.test.ts:642`(summary 不受分帳影響)、`:807`(分帳不改變任何預算)。**這兩條只有在 2.5 把真的 `FinanceSharesMirror` 接進 `buildApp` 之後才會反轉** —— 若它們改完仍然綠,不是「沒影響」,是**接線沒接上**,回去看 2.5。
- [ ] 13.3 其餘因為「分帳現在會產生交易」而失敗的,逐條判斷是合法的預期變化還是真的弄壞了,不要用改斷言的方式繞過。
