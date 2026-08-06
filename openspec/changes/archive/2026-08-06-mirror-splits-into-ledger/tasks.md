# Tasks

**這個 change 的賣點是一致性,所以每個守門都要能抓到「兩邊對不上」。**

而**測得到的前提是鏡像在應用層算**(D2)。第一版把它放在 adapter 裡,結果 `finance.test.ts` 用的是 `InMemorySplitExpenseRepository`(`fakes.ts:120`,`create` 只做 `rows.push`),**HTTP 層看不到任何鏡像**,底下十幾個守門一個都寫不出來。動手前先確認 D2 的形狀真的照做了。

## 0. 先決定,再動手

- [x] 0.1 `split-into-budget` 已刪除。確認 repo 裡沒有殘留的 `SplitSpentLookup`、`includes_split`。
- [x] 0.2 **數過了(2026-08-06,對 `.dev.vars` 的 Neon 連線跑唯讀 count):`split_expense` = 0、`split_share` = 0。** 第 10 節整段不做,寫進 PR。

## 1. 分帳加分類欄位(D1)—— 這是新功能,不是接線

- [x] 1.1 `split_expense.category_name text null`。**存名字不存 id**(分類是 per-user 的)。
- [x] 1.2 `CreateExpenseInput`/`UpdateExpenseInput`、`validateExpenseFields`、`POST /api/split/expenses`、**`PATCH /api/split/expenses/:id`**(不是 PUT,`app.ts:478`)、`GET` 的回應都要帶。
- [x] 1.2a `category_name` 的輸入規則要寫進 `validateExpenseFields`,並補進 split-bills 那條「其餘一律 400」的輸入契約:**空字串當成 null**、長度上限。**不做前後空白修剪** —— 規格的 scenario 寫「讀回來就是送進去的那個名字」,修剪會跟它打架,而分類名字本來就是照使用者輸入存的。**要有測試**,不是只加欄位。
- [x] 1.2b **`PATCH` 沒帶 `category_name` = 清空**(D1)。handler 對其他欄位都是全取代,這個保持一致。**要有一條測試**(`split.test.ts`「clears the category name when a PATCH omits it」)**並且寫進 split-bills 規格**,前端在另一個 repo,不寫下來就是靠掉資料發現。突變:改成「沒帶就沿用原值」→ 那條測試紅(已驗)。
- [x] 1.3 **前端契約改動有三處**,全部寫進 PR:分帳建立表單多一個分類選擇;**每一筆交易的回應與列表都要帶「來自分帳」的標記**(前端才鎖得住欄位);**`GET /api/finance/split-spending` 每個幣別多一個「是否已計入交易」旗標**。前端在另一個 repo。

## 2. `SharesMirror` port(D2)

- [x] 2.1 `src/contexts/split/domain/shares-mirror.ts` 定義 `MirrorPlanInput`、`ShareMirrorRow`、`plan()`、`afterWrite()`。**port 在 split 的 domain,實作在 finance 那側**;split 的 domain/application 不 import `contexts/finance/`。**split 的 adapter 會 import `shared/db/schema` 的 `financeTransaction`** —— 那是允許的,寫在註解裡。
- [x] 2.2 `SplitExpenseRepository.create/update` 簽章收一組鏡像列。**repository 不算鏡像,只把拿到的列放進 batch。**
- [x] 2.3 `createExpense`/`updateExpense` 呼叫 `plan`,寫入成功後呼叫 `afterWrite`。**`deleteExpense` 不呼叫**(刪除靠 cascade)。**`id` 要從 `deps.expenses.create({ id: crypto.randomUUID(), … })` 裡提出來**(`create-expense.ts:36`),`plan` 需要它。
- [x] 2.4 **突變:把 `plan` 從應用層刪掉。** 3.x 必須紅 —— 因為 `InMemorySplitExpenseRepository` 就不再收到任何鏡像列。(**不要**把突變寫成「改在 `DrizzleSplitExpenseRepository` 裡重新實作解析」:3.x 走的是 in-memory 那個,施加在 Drizzle 上的突變它碰不到,那樣寫守門是死的。)
- [x] 2.5 **`FinanceSharesMirror` 在 `createApp` 裡組**,用它已經持有的 **`financeCategoryRepository`(`plan` 解析分類用)+ `financeBudgetRepository` + `budgetAlertNotifier`(`afterWrite` 跑 `checkBudgetAlerts` 用,`CheckBudgetAlertsDeps` 是 `{ budgetRepository, categoryRepository, notifier }`)**。**不需要 `financeTransactionRepository`** —— 鏡像是 repository 放進 batch 的,不經過它。**不要給 `CreateAppOptions` 加 `sharesMirror`** —— 有 22 個測試檔呼叫 `createApp`,而且 `finance.test.ts` 會傳 fake 進去,分類解析就變回不可測。
- [x] 2.6 **`InMemorySplitExpenseRepository` 的建構子要收 `InMemoryFinanceTransactionRepository`,鏡像寫進去** —— 而且**要照 `(user_id, split_expense_id)` 這個身分鍵做 upsert、要照 `category_source` 條件覆寫、要刪掉不再是分攤者的那些**。只做「append 一筆」的話,7.3、「編輯分帳兩邊都動」、「移除的分攤者失去鏡像」在 HTTP 層**都觀察不到**。 它現在只有 `rows: SplitExpense[]`,而 finance 的端點讀的是**另一個物件**(`test/contexts/finance/fakes.ts:69`)。**fake 把鏡像存進自己的 list 的話,3.x/4.x/6.x/7.x/8.x/9.x 全部看不到鏡像** —— 那就是 D2 想修的問題往下搬一層。
- [x] 2.7a **finance 那側的波及面**:`FinanceTransaction`、`CreateFinanceTransactionInput`、`ReplaceFinanceTransactionInput`、`FinanceTransactionRepository.update`、`transactionToJson`、`InMemoryFinanceTransactionRepository` 都要帶 `splitExpenseId` / `categorySource`。
- [x] 2.7b **`delete-transaction.ts` 目前沒有任何讀取**(`repository.delete(userId, id)`,五行,沒有 `findById`),**所以 7.1 的「DELETE 一律拒絕」實作不出來**。要嘛加一次讀取,要嘛在 repository 層加述詞。**同時決定回什麼狀態碼**(過濾式刪除會變 404;明確拒絕是 400/409)—— 7.5 的兩條測試需要這個答案。
- [x] 2.7c **`test/adapters/http/split.test.ts` 的 `financeCategoryRepository` / `financeTransactionRepository` / `financeBudgetRepository` 全是會丟錯的 `notImplemented` stub(`split.test.ts:213-235`)。** `createApp` 一旦組出 `FinanceSharesMirror`,那個檔案裡**每一條建立/編輯分帳的測試都會 500**。這是最大的波及面,而 2.7 自稱是「不要邊做邊發現」的清單。
- [x] 2.7d **`split_expense_id` 與 `category_source` 永遠不從請求 body 讀**(D17)。`updateTransaction:38` 是 `{...input, type, currency}` 展開 —— 欄位進了 replace input 而 handler 沒填,`PUT` 會**把連結清成 null**,鏡像瞬間解鎖;handler 若從 body 讀,客戶端就能自己掛上或拆掉。**突變:讓 `PUT` 從 body 讀 `split_expense_id`**,一條「送一個假的 `split_expense_id` 上去,交易的連結不變」的測試必須紅。**這個突變不是改一行 handler**:D17 讓 `splitExpenseId` 不在 `ReplaceFinanceTransactionInput` 裡,所以突變還要把欄位加進輸入型別、`FinanceTransactionRepository.update`、以及 in-memory fake 的 `update`(它是逐欄位指派,`fakes.ts:96-106`)。**只改 handler 會型別錯誤或什麼都不做,那不叫驗證過。**
- [x] 2.7 split 那側的波及面:`CreateExpenseDeps`(`create-expense.ts:8`,`updateExpense` 共用)、`routes/split.ts:421` 的兩個 handler、五個 split 應用層測試檔、`stubSplitExpenseRepository`(`split-stubs.ts:26`)。**逐個列出來改,不要邊做邊發現。**

## 3. 分類解析(D4)

- [x] 3.1 同名 `type='expense'` → 「其他」`type='expense'` → **「其他」不在就 `insertDefaultsIfMissing` 再回第 1 步**(不是第 2 步 —— seed 也建出了分帳指名的那個分類)。**只有三步** —— 不要加「退到任何一個支出分類」的第四步,見 3.1b。
- [x] 3.1a **第 3 步的條件是「其他不在」,不是「一個分類都沒有」。** 分類可以改名(`update-category.ts:21-26`),改名之後舊條件不觸發,解不出 `category_id`,而它是 NOT NULL —— **付款人一次合法的建立分帳,會因為一個無關的參與者改過名字而失敗。**
- [x] 3.1b **突變:把條件改回「一個分類都沒有」。斷言不能寫成「付款人仍然建得起分帳」** —— 改名的使用者當然還有別的分類,只要有任何退路,那個斷言在突變下照樣綠(這正是第一版加了第四步之後發生的事)。**斷言要指名落在哪:鏡像的分類名字是「其他」、`type` 是 expense,而且分攤者的支出分類數量比之前多一(代表真的重新 seed 了)。**
- [x] 3.1c **不要加第四步的退路。** 步驟 3 正確時它到不了,而它唯一的效果是廢掉 3.1b。
- [x] 3.2 **突變:拿掉 seed 那一步**,一個「參與者從沒開過記帳頁」的 fixture 必須紅。fixture 要真的讓那個使用者**一個分類都沒有** —— **不能先呼叫 `GET /api/finance/categories`**,那會把他 seed 掉,測試就永遠綠。
- [x] 3.3 **突變:名字解析不限定 `type`。兩個步驟各要一條測試** —— 規格的 scenario 講的是步驟 1,而只測步驟 2 的話步驟 1 完全沒有守門。

  **fixture 不能靠「指定 `sortOrder`」或「先建 income 那筆」來釘。** `findByUserTypeName` 兩個實作**都不排序**:adapter 是沒有 `ORDER BY` 的 `.limit(1)`(`drizzle-finance-category-repository.ts:41-49`),fake 是 `.find()` 照插入順序(`test/contexts/finance/fakes.ts:32-34`)。而預設 seed 把 expense 的「其他」排在 income 之前(`default-categories.ts` index 6 vs 10),所以照一般寫法,拿掉 `type` 述詞的突變**照樣撿到對的那筆,守門是死的**。

  **要用「同名的只有 income 那一筆」把它釘死,不依賴任何順序:**
  - **步驟 1**:分帳指定「餐飲」,分攤者只有 **income** 的「餐飲」,沒有 expense 的。正確的程式碼步驟 1 不中 → 退到「其他」;**突變**步驟 1 中了 income 的餐飲 → 鏡像落在收入分類上。斷言鏡像的分類是「其他」且 `type` 是 expense。
  - **步驟 2**:分攤者的 expense「其他」被改名,而且有一個 income 的「其他」。正確的程式碼步驟 2 不中 → seed → 落在重建的 expense「其他」;**突變**步驟 2 中了 income 的「其他」。斷言同上。(這條跟 3.1b 共用 fixture。)
- [x] 3.4 **突變:改用付款人的 `category_id`**,一個「兩人分類 id 不同但同名」的 fixture 必須紅。**斷言方式只能是「鏡像的 `category_id` 等於分攤者自己那個 id」** —— 不要斷言「寫入失敗」:`finance_transaction.category_id` **沒有**任何把它綁到同一個 `user_id` 的約束,付款人的 id 存在,插入會成功,只是把錢記到別人的分類上。
- [x] 3.5 封存分類:鏡像照用。**測試同時斷言 `POST /api/finance/transactions` 選同一個分類仍然被拒**(`create-transaction.ts:28`)—— 只斷言前半的話,「乾脆把 create 的封存檢查拿掉」這個突變會活下來。兩件事都在 HTTP 層,同一條測試寫得出來。

## 4. 不覆蓋使用者改過的分類(D6)

- [x] 4.1 更新寫成 `INSERT … ON CONFLICT (user_id, split_expense_id) DO UPDATE`,只在 `category_source = 'mirror'` 時覆寫 `category_id`。
- [x] 4.2 **不要沿用 share 的「刪光再插」**(`drizzle-split-expense-repository.ts:185-186`)。那會炸掉 `category_source='manual'`,而且會讓 5.3 的唯一索引守門變成不可能失敗。
- [x] 4.3 **這條在 `test/db`(PGlite),不在 HTTP 層。** 覆寫語意住在 `ON CONFLICT DO UPDATE` 的 SET 清單裡,HTTP 層施加突變只能改 in-memory fake —— 一個跟自己一致的 fake,證明不了生產的 SQL。
- [x] 4.4 **突變:SET 清單裡的 `CASE` 改成無條件覆寫 `category_id`**,一條「使用者改分類 → 付款人改金額 → **分類不變且金額有變**」的 PGlite 測試必須紅。**金額那半一定要斷言** —— 少了它,「乾脆什麼都不更新」這個突變會活下來。
- [x] 4.6 **另一個方向也要守:突變「鏡像寫入時不設 `category_source = 'mirror'`」。** 沒設的話欄位吃預設值 `'manual'`,`CASE` 永遠不觸發,**鏡像的分類從此再也不跟著分帳走**。現有的 scenario 全部只斷言「保留」,一條都不會紅。要一條「分帳原本是餐飲,付款人改成娛樂,分攤者從沒動過 → 鏡像的分類跟著變成娛樂」的測試。
- [x] 4.7 **`category_source` 本身不能進 SET 清單。** 加 `categorySource: sql`'mirror'`` **1247 條測試全綠** —— `ON CONFLICT DO UPDATE` 的每個 SET 運算式都對**舊列**求值,所以第一次編輯時 `CASE` 照樣保住分類,第二次才把使用者的選擇蓋掉。既有的每一條都只編輯一次。要一條「重新分類後**連續編輯兩次**」的 PGlite 測試(`split-expense-mirrors.test.ts`「keeps that category through a second edit」),並且**要斷言 `category_source` 仍是 `'manual'`**。突變已驗:紅。
- [x] 4.8 **`note` 不進 SET 清單也要有守門(D18)。** 加 `note: sql`excluded.note`` 全綠,因為 fixture 的 planned 與 stored note 都是 `"dinner"`,兩者分不出來。`mirror()` 的 note 改成參數,寫一條「分攤者改過 note → 付款人改分帳描述 → note 不變、金額照樣跟著走」。突變已驗:紅。
- [x] 4.5 **`category_source` 的條件不能寫成 `DO UPDATE … WHERE`** —— 那會跳過整列,連 amount 都不更新。要寫成 SET 清單裡的 `CASE`。4.4 的金額斷言就是擋這個的。

## 5. Schema(D5)

- [x] 5.1 `finance_transaction.split_expense_id uuid null references split_expense(id) on delete cascade`。
- [x] 5.2 `finance_transaction.category_source text not null default 'manual'`。
- [x] 5.3 部分唯一索引 `(user_id, split_expense_id) where split_expense_id is not null`。**突變:索引與 `ON CONFLICT` 的目標「一起」縮成 `(user_id)`**,一條「同一個人在同月有**兩筆不同的分帳**,兩筆鏡像都在」的 PGlite 測試必須紅 —— 縮窄之後第二筆會衝到第一筆上、去更新錯的列。
- [x] 5.3b **只縮索引、不動 `ON CONFLICT` 目標是不行的**:那會讓 Postgres 在計畫階段就報 *there is no unique or exclusion constraint matching the ON CONFLICT specification*,**第一次寫鏡像就紅**,紅在 SQL 錯誤而不是重複列 —— 正是 5.3a 說不算數的那種。
- [x] 5.3a **也不要用「拿掉索引」當突變**:4.1 是 `ON CONFLICT (user_id, split_expense_id)`,拿掉索引會讓 Postgres 直接報 *there is no unique or exclusion constraint matching the ON CONFLICT specification*,**每一條寫鏡像的測試都會紅**,紅在 SQL 錯誤而不是重複列。那只證明索引存在,不證明它是對的索引。
- [x] 5.3c **「同一筆分帳編輯兩次,每個分攤者仍然只有一筆鏡像」要有自己的測試**(規格的 scenario)。**能讓它紅的突變是「upsert 改回單純的 insert」**(第二次寫入撞唯一索引而不是更新);5.3 那條縮索引+ON CONFLICT 的突變**它活得下來**(一個 (user, split) 一列本來就成立),那個由「leaves the other split's mirror alone」抓。不要謊稱兩者是同一個守門。
- [x] 5.4 移除的分攤者:batch 裡帶 `delete … where split_expense_id = ? and user_id not in (…)`。**集合式的,不需要知道編輯前是誰** —— adapter 刻意不讀 grouped expense 的舊分攤者(`:182-183`),那個最佳化不該為這個 change 死掉。鏡像集合為空時 `notInArray(col, [])` 在 drizzle-orm 0.45.2 產生 `true`,是安全的。
- [x] 5.5 **這條也在 `test/db`(PGlite),理由同 4.3。突變:拿掉那條 delete**,一條「grouped expense 移除一個分攤者後,他的交易不見了」的測試必須紅。**fixture 要用 grouped 的**。**groupless 的也要一條** —— 規格寫的是「不管屬不屬於群組」,而 groupless 那條路徑 adapter 會去讀編輯前的分攤者(活動的 audience 要),所以只有 grouped 的 fixture 蓋不到「用舊名單去刪」這個寫法。兩條都在,誰也不取代誰。
- [x] 5.7 **batch 裡鏡像的 insert 必須排在 `expenseInsert` 之後**(FK 立即檢查)。這個 repo 對語句順序寫得很重(`:270`),照做。**這條不需要專屬的突變測試** —— 排錯順序會讓**每一條**建立分帳的測試 FK 失敗。在註解裡寫明理由即可,**不要謊稱它有突變驗證**。
- [x] 5.6 刪除分帳靠 `on delete cascade`,**不在 batch 裡另外刪**(`delete` 是單一 `db.delete(splitExpense)`)。

## 6. 警示(D2、#76)

- [x] 6.1 `afterWrite` 對每個鏡像跑 `checkBudgetAlerts`,**盡力而為**:丟錯不影響分帳寫入(比照 `create-transaction.ts:41`)。
- [x] 6.2 **突變:拿掉 `afterWrite` 呼叫**,一條「分帳讓分攤者跨過 80% → `FakeBudgetAlertNotifier` 收到一則」的測試必須紅。兩個 fixture 條件都不能少:
  - **自付額要真的跨過門檻**:總額 1800 平分是自付 900,對 1000 的預算是 90%。拿 900 平分(自付 450)是 45%,突變會活下來。
  - **被通知的要是「不是寫入者」的那個分攤者**。#76 和 D13 講的就是這件事;拿付款人自己當受測對象是沒意思的那一半。
- [x] 6.2a **編輯路徑也要有自己的守門。** 6.2 只蓋到建立那半:把 `update-expense.ts` 的 `writeMirrorAftermath` 整行刪掉,1241 條測試**全綠**。要一條走 `editSplitExpenseBetween` 的警示測試。
- [x] 6.2b **`afterWrite` 收到的必須是「寫進去的」列,不是 `plan` 的列**(D19a)。分攤者改過分類的鏡像,`plan` 說餐飲、資料庫是娛樂 —— 用 `plan` 的列去查,永遠查不到那筆錢真的在的分類。repository 的 `create`/`update` 回傳 `SplitExpenseWriteResult`,`mirrors` 來自 upsert 的 `.returning()`。
  - **HTTP 層的守門一條蓋兩件事**(`finance.test.ts`「checks the category a recategorised mirror now carries when the split is edited」):分攤者把鏡像搬到有預算的娛樂 → 付款人改金額 → 收到一則娛樂的 80% 通知。**兩個突變各驗過**:刪掉編輯路徑的 `writeMirrorAftermath` → 紅;改回傳 `plan` 的列 → 紅。
  - **SQL 那半在 `test/db`**(「hands back the stored category, not the planned one」):HTTP 層走的是 in-memory fake,證不了 `.returning()` 真的回傳 `CASE` 之後的值。突變:`written = mirrors` → 紅(已驗)。
- [x] 6.3 **突變:不 catch `afterWrite` 的錯誤**,一條**應用層**測試必須紅:用會丟錯的 `SharesMirror` stub,斷言 `createExpense` 仍然回傳、鏡像列仍然傳進了 repository。(**這條不要斷言 HTTP 狀態碼** —— 應用層看不到它。)
- [x] 6.3b 規格說的是「API 回 200」,那是 **HTTP 層**的宣稱,要有自己的測試。**`financeBudgetRepository` 是 `createApp` 的 option**,傳一個會丟錯的進去就是一條真的端到端守門。**丟錯的要是 `findByUserAndCategory`,或者 fixture 要先給分攤者一個預算** —— `checkBudget` 在沒有預算時就從 `findByUserAndCategory` 早退,`getSpent` 根本跑不到。**突變:不 catch** → 分帳的 `POST` 變成 500,測試紅。
- [x] 6.3a **不要用「notifier 丟錯」當那個突變** —— `check-budget-alerts.ts:65-69` **已經**把 notifier 的錯誤吞掉了(`try { notify } catch { console.error }`),所以會丟錯的 notifier **永遠不會讓 `afterWrite` 丟錯**,那個守門是死的。要丟錯就從 port 這一層丟。
- [x] 6.4 既有的「同一個 (budget, month, threshold) 永不重複通知」不能被破壞。

## 7. 半唯讀(D7)

- [x] 7.1 `split_expense_id is not null` 的交易:`DELETE` 一律拒絕;`PUT` **只在 amount/date/currency/`type` 的值真的不同時**拒絕。
- [x] 7.1a **`type` 一定要在鎖住的清單裡。** `PUT` 是全取代而 `type` 是它的一部分(`update-transaction.ts:29`),分攤者可以把鏡像翻成 `income`(挑一個收入分類,`update-transaction.ts:34` 會收)。那 900 元就離開支出總額、離開每個預算的 `spent`,變成 +900 收入,而分帳那邊還說他欠 900 —— **用被允許的編輯路徑做出這個 change 要消滅的那種不一致。突變:把 `type` 從鎖住清單拿掉**,一條「翻成 income 被拒、且 summary 的支出總額不變」的測試必須紅。
- [x] 7.2 **`PUT` 是全取代**,只改分類的客戶端一定會重送 amount/currency/date。**「帶了就拒絕」會讓唯一允許的編輯做不到。** 比較前要正規化 currency 大小寫與日期形式。
- [x] 7.3 改分類時把 `category_source` 設成 `'manual'`。**突變:不設**,一條 HTTP 層的測試必須紅:分攤者 `PUT` 改分類 → 付款人再編輯分帳 → **分類仍然是分攤者選的那個**。4.4 在 PGlite 層證不了這件事,那裡的 `'manual'` 是測試自己寫進去的,**從來沒有經過 PUT handler**。
- [x] 7.4 **在後端擋** —— 前端在另一個 repo,API 是公開的。
- [x] 7.5 **突變:只擋 delete 不擋 update**(以及反過來),兩個方向各要有一條測試紅。
- [x] 7.6 **突變:改成「帶了 amount 就拒絕」**,一條「重送相同的 amount/date/currency 只改分類 → 200」的測試必須紅。
- [x] 7.8 **`categoryChanged` 那半要有守門。** 拿掉 `&& categoryChanged`(任何 `PUT` 都標 `'manual'`)全綠 —— 但 `PUT` 是全取代,只改 note 的客戶端會重送同一個 `category_id`,那個突變會讓那筆鏡像的分類**永遠**凍住。要一條「只改 note 的 `PUT` → 付款人改分帳的分類 → 鏡像跟著走」。突變已驗:紅。
- [x] 7.9 **值的比較擋不住比較完到寫入之間那一段(D7)。** `update-transaction.ts` 是先讀再全取代,沒有鎖也沒有版本欄位:分攤者讀到 900、付款人的編輯把它變成 1200、分攤者的 `PUT` 把 900 無條件寫回去 —— 帳本 900、分帳 1200,永久而且沒有錯誤。repository 的 `update` 多收 `expected`(`type`/`amount`/`currency`/`date`),鏡像才傳,匹配不到就答 **409 `MirroredTransactionChangedUnderneath`**(不是 400:請求當時合法,重讀再送可能成功)。**守門在應用層** —— 交錯只能在 `updateTransaction` 自己那次讀之後製造(`RacingTransactionRepository`),HTTP 層碰不到那個縫;**SQL 那半在 `test/db`**,因為 in-memory 的判斷只能跟自己一致。兩個突變都驗過:拿掉 `expected` 參數 → 紅;拿掉 adapter WHERE 裡的述詞 → 紅。**反向也要一條**「沒人來搶就照常寫入」,否則「永遠拒絕」活得下來。
- [x] 7.10 **`deleteTransaction` 的擁有權檢查(`|| existing.userId !== userId`)在一般列上看不見** —— `repository.delete` 本來就是 owner-scoped,拿掉照樣 404。**別人的鏡像**才是差別:那會答 400 `MirroredTransactionReadOnly`,等於告訴陌生人「這個 id 存在,而且是一筆分帳」。要一條應用層測試。突變已驗:紅。
- [x] 7.7 回應要標明這筆來自分帳(`GET` 列表也要),讓前端能把欄位鎖起來。

## 8. 零元分攤、結清、墊錢(D8、D9)

- [x] 8.1 零元分攤**不產生鏡像**。split 允許零元(`validate-expense-fields.ts:97-99`,CHECK 是 `amount >= 0`),finance 要求 `amount > 0`,而 `finance_transaction.amount` **沒有 CHECK** —— 繞過應用層就會靜默寫進一筆 0 元交易。
- [x] 8.2 **突變:零元也產生鏡像**,一條「三人分攤其中一人 0 元 → 只有兩筆交易」的測試必須紅。**fixture 必須用 `mode: "exact"`** —— 三人平分做不出零元(要 `amount < 3`,而那會被 `validate-expense-fields.ts:86-90` 直接擋掉)。而且 `createSplitExpenseBetween`(`finance.test.ts:305`)**只支援兩人**,要先寫一個三人的 helper。
- [x] 8.3 墊錢但沒分攤的付款人不產生鏡像。**兩個突變都要有,它們抓的不是同一件事:**
  - **突變:付款人拿全額鏡像** → 一條「A 付 1800、A 分攤 900 → A 的交易是 900」的測試必須紅。
  - **突變:即使付款人沒有分攤也給他鏡像** → 一條「A 全額替 B、C 墊,A 完全沒有分攤 → **A 一筆交易都沒有**」的測試必須紅。第一個突變抓不到這個(付款人根本沒有 share,「全額 vs 自付額」不成立),而規格寫的是這一句(`fronting money for others is not spending`)。`validate-expense-fields.ts:96-101` 確認付款人不持分攤是合法的。
- [x] 8.4 結清不產生鏡像。**這條不寫突變測試** —— 結清由完全不同的 repository 寫(`create-settlement.ts`),這個 change 一行都沒碰它,沒有任何**對這個 change 的**突變能讓它產生鏡像。寫一條「結清後交易數量不變」的斷言當回歸即可,**不要謊稱它有突變驗證**。

## 9. 白名單外的幣別(D10、D11)

- [x] 9.1 白名單外不產生鏡像,**分帳本身照樣寫成功**。
- [x] 9.2 **突變:白名單外整筆失敗**,一條 THB 分帳的測試必須紅。
- [x] 9.3 `GET /api/finance/split-spending` 每個幣別標明是否已計入交易。**突變:標記寫死成同一個值**,一條**同時有 TWD 與 THB 分帳**的測試必須紅 —— 只測一種幣別的話常數會活下來。

## 10. 回填 —— **不做**

- [x] 10.1 0.2 數出 `split_expense` = 0,上線時分帳表是空的,**沒有東西要回填,新舊界線不存在**。PR 裡寫明這件事,以及它是數出來的而不是假設的。

## 11. `test/db` 要先接起來(D15)

- [x] 11.1 `harness.ts:116` 的 `TABLES` **一張 finance 表都沒有**,`test/db/` 下沒有建構過任何 finance repository。原子性、upsert、cascade、唯一索引的守門**全部需要先接這條路**。
- [x] 11.2 原子性測試用 `withBatchShim`(`harness.ts:100-114`,真的 Postgres 原子性,rollback 被 `harness-batch.test.ts` 釘住)。
- [x] 11.3 **原子性的突變要有可注入的失效點**:讓 `plan` 回一列帶著不存在的 `category_id`,batch 就會 FK 失敗。**沒有這個縫,2.x 的原子性守門寫不出來** —— 分類解析在 batch 之前跑、對的是真的資料列,而 PGlite 是單一連線,沒有東西能在中途把分類刪掉。
- [x] 11.4 **突變:把鏡像從 batch 搬到 batch 之後用第二次 await 寫**,11.3 的失效點必須讓「分帳存在但鏡像不存在」紅。

## 12. 別人會動你的帳本(D13)

- [x] 12.1 付款人刪分帳 → cascade **刪掉你帳本裡一筆真的交易**;付款人改金額 → 可能把你推過預算門檻並通知你。**寫進 PR 的 Impact。**
- [x] 12.2 目前沒有任何通知路徑告訴你記帳頁發生了什麼(分帳動態有,記帳頁沒有)。**不在這個 change 做 —— 已開 issue #78。**
- [x] 12.3 **封存群組裡的分帳仍然可編輯**(`update-expense.ts:43` 傳 `checkArchived: false`,規格明說封存群組的支出保持可修正),所以封存群組裡的一次編輯照樣會動別人的帳本。**這是對的,但要寫出來**,否則會被當成漏洞。

## 13. 驗證

- [x] 13.1 `npm test`、`npm run typecheck` 全綠。
- [x] 13.2 既有測試的反轉:`finance.test.ts:642`(summary 不受分帳影響)、`:807`(分帳不改變任何預算)。**這兩條只有在 2.5 把真的 `FinanceSharesMirror` 接進 `buildApp` 之後才會反轉** —— 若它們改完仍然綠,不是「沒影響」,是**接線沒接上**,回去看 2.5。
- [x] 13.3 其餘因為「分帳現在會產生交易」而失敗的,逐條判斷是合法的預期變化還是真的弄壞了,不要用改斷言的方式繞過。

## 14. 不要寫的測試

- [x] 14.1 **「淨值不動」不要寫成測試。** 那是 by construction 的(networth 的 adapter 根本不讀 `finance_transaction`,D12),沒有任何突變能讓它紅。split-bills 那條「真資料庫驗證」的要求**明文禁止**這種形狀:「state it where the code is instead」。**寫在註解裡**(已寫在 `drizzle-networth-repository.ts` 開頭)。
- [x] 14.2 同理,5.7(batch 語句順序)、8.4(結清)、10.2(回填不發警示)都已標明沒有突變驗證。**不要為了湊數補上假的。**
