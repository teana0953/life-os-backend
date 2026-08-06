# Design

## D0:`split-into-budget` 已作廢,由這個 change 取代

那個 change 走的是「查詢時多加一個來源」,只修總預算,而且明說分類預算、警示(#76)、summary(#77)都還是假的。已刪除(2026-08-06)。**兩套同時存在 = 每一筆分帳被算兩次。**

## D1:分帳支出**現在沒有分類欄位**,這個 change 要加

`split_expense` 沒有任何分類欄位,`CreateExpenseInput`/`UpdateExpenseInput` 沒有,`validateExpenseFields` 沒有 —— `grep -rn "categor" src/contexts/split/` **零筆**。

第一版的設計整段建立在「付款人建分帳時選一個分類」上,而那個東西**不存在**。要加:

- `split_expense.category_name text null` —— **存名字,不存 id**

存名字而不是 id,因為分類是 per-user 的:付款人的「餐飲」id 對參與者沒有意義,而這個欄位要被所有參與者讀。存 id 會逼每次讀取都去反查名字。

`null` 代表付款人沒選,鏡像退到各自的「其他」。**這也是前端契約改動**(分帳建立表單多一個分類選擇),前端在另一個 repo。

## D2:鏡像在**應用層**算出來,由 repository 放進 batch —— 不是在 adapter 裡拼 SQL

第一版把鏡像寫成「adapter 在 batch 裡多加幾條語句」。那個形狀有兩個致命後果:

**一、警示永遠不會響。** `checkBudgetAlerts` 只有 `create-transaction.ts:34` 與 `update-transaction.ts:43` 兩個呼叫點,都在**應用層**。batch 裡直接插進去的列不經過任何一個,所以 #76 不會關掉 —— 而第一版的 proposal 寫「三個一起關掉」。**這是同一個錯誤第三次出現在警示這件事上。**

**二、所有守門都寫不出來。** `test/adapters/http/finance.test.ts` 用 `InMemorySplitExpenseRepository`(`fakes.ts:120`),它的 `create` 只做 `this.rows.push(expense)`。鏡像若住在 `DrizzleSplitExpenseRepository`,HTTP 套件**看不到任何鏡像**,`finance.test.ts:642` 與 `:807` 會**保持綠**,而生產行為跟它們斷言的相反。要在那層測就得在 fake 裡把鏡像邏輯再實作一次 —— 一個**跟自己一致的 fake**,正是不可能失敗的守門。

### 正確的形狀

在 **split 的 domain** 定義它需要的東西,由 finance 提供實作。**依賴方向是 finance → split,split 的 domain/application 不 import finance。**

**但 split 的 adapter 會 import `shared/db/schema` 的 `financeTransaction`** 才能把列放進 batch。CLAUDE.md 允許 adapter 用 `shared/db`,**但這件事要寫出來**,否則之後會有人把它「修掉」。

```ts
// src/contexts/split/domain/shares-mirror.ts
export interface ShareMirrorRow {
  userId: string; splitExpenseId: string; amount: number; currency: string;
  categoryId: string; day: string; note: string | null;
}

/** `plan` 需要的分帳事實。id 必須先產生 —— 見下方。 */
export interface MirrorPlanInput {
  splitExpenseId: string; currency: string; day: string;
  description: string; categoryName: string | null;
  shares: { userId: string; amount: number }[];
}

export interface SharesMirror {
  /** 解析每個分攤者的分類、決定誰有鏡像。批次寫入前呼叫。 */
  plan(input: MirrorPlanInput): Promise<ShareMirrorRow[]>;
  /** 批次寫入成功後呼叫。盡力而為,失敗不影響分帳。 */
  afterWrite(rows: ShareMirrorRow[]): Promise<void>;
}
```

- `createExpense` / `updateExpense` **應用層**呼叫 `plan`,把結果傳給 repository(`deleteExpense` 不呼叫 —— 刪除靠 cascade,沒有東西要 plan)
- **`id` 要從 repository 呼叫裡提出來**:現在是 `deps.expenses.create({ id: crypto.randomUUID(), … })`(`create-expense.ts:36`),而 `plan` 需要 id 才能填 `splitExpenseId`
- repository 的簽章變成 `create(input, mirrors)` —— **它不算鏡像,只負責把拿到的列放進同一個 batch**
- 寫入成功後應用層呼叫 `afterWrite`,那裡面才去跑每個分攤者的預算警示

### 接線:在 `createApp` 裡組,不加新 option

`createApp` **已經**同時持有 `financeCategoryRepository` 與 `financeTransactionRepository`(`app.ts:191-192`)。`FinanceSharesMirror` 在 `createApp` 裡組出來即可。它需要的是 **`financeCategoryRepository`**(`plan` 解析分類)加上 **`financeBudgetRepository` + `budgetAlertNotifier`**(`afterWrite` 跑 `checkBudgetAlerts`,其 deps 是 `{ budgetRepository, categoryRepository, notifier }`)—— **不需要 `financeTransactionRepository`**,鏡像是 repository 放進 batch 的,不經過它。

**不要給 `CreateAppOptions` 加 `sharesMirror`**:有 **22 個測試檔**呼叫 `createApp`,加 option 等於全部要改,而且 `finance.test.ts` 會傳一個 fake 進去 —— 那就把分類解析變回不可測。在 `createApp` 裡組,`finance.test.ts` **自動拿到真的實作**。

這跟既有的 `budgetAlertDeps()`(`routes/finance.ts:143`)是同一個形狀:具體 adapter 由 `src/index.ts` 注入,`createApp` 只是把它們組成一個服務。

### fake 也必須寫進 finance 讀得到的地方

`InMemorySplitExpenseRepository`(`fakes.ts:120`)只有 `rows: SplitExpense[]`,而 `/api/finance/transactions`、`/summary`、`/budgets` 讀的是 **`InMemoryFinanceTransactionRepository`**(另一個物件,`test/contexts/finance/fakes.ts:69`)。

**fake 若把鏡像存進自己的 list,finance 的端點一個都看不到** —— 那就是 D2 想修的那個問題往下搬一層。**fake 的建構子要收 `InMemoryFinanceTransactionRepository`,鏡像寫進去。**

### 這個形狀解掉了什麼

- **警示會響**:`afterWrite` 在應用層,可以呼叫 `checkBudgetAlerts`
- **fake 不用重新實作邏輯**:`InMemorySplitExpenseRepository.create(input, mirrors)` 只是把收到的列存起來;**解析邏輯在 finance 那側的實作裡**,而 `finance.test.ts` 本來就有 in-memory 的 finance repository,可以把**真的**實作接上去 —— 分類解析因此是**真的被測到**,不是被 fake 模仿
- **原子性保留**:鏡像仍然在同一個 `db.batch` 裡

## D3:原子性只保得住寫入,`plan` 的讀寫在批次之外

`drizzle-orm/neon-http` 沒有 `transaction()`,`db.batch` 是唯一的原子單位。鏡像列跟分帳列在同一個 batch,所以**寫入是原子的**。

但 `plan` 在 batch 之前跑,而且它**會寫**(參與者一個分類都沒有時要 seed,見 D4)。**batch 之後 rollback 的話,那個使用者會多出 11 個分類,而那次操作從沒發生過。**

這是真的漂移,只是無害的那種:seed 是 idempotent 的,而且使用者遲早會有那些分類。**明說,不要假裝原子性覆蓋了整段。**

## D4:分類解析,**必須保證終止**

`finance_transaction.category_id` 是 NOT NULL,解不出來就寫不進去。

1. 參與者有**同名**、**`type = 'expense'`** 的分類 → 用它
2. 沒有(或分帳沒指定分類名)→ 用他 `type = 'expense'` 的「其他」
3. **一個分類都沒有** → 先 seed 預設分類,再回第 2 步

**第 1、2 步都要限定 `type = 'expense'`。** `DEFAULT_CATEGORIES` 裡「其他」**同時存在於 expense 與 income**(`default-categories.ts:11,15`),唯一索引是 `(user_id, type, name)`。挑到 income 的那個,支出會被記在收入分類上,而 `getMonthlySummaryRaw` 按分類分組 —— 那會是一個看不出來的錯。

第 3 步不是防禦性程式碼:`ensureDefaultCategories` **只有** `listCategories` 一個呼叫點(`list-categories.ts:7`),而且只在使用者**一個分類都沒有**時才 seed。一個從沒開過記帳頁的朋友被拉進分帳,他的 `finance_category` 是空的。**分頁載入順序決定了資料能不能寫進去。**

### 鏡像**可以**落在封存的分類上,一般的建立不行

`create-transaction.ts:28` 明確擋封存分類。鏡像刻意不套這條:一般建立是**使用者在選**,擋住是為了不讓封存的東西回到選單;鏡像**不是選擇**,擋住的代價是**一筆真的花掉的錢寫不進去**。

刻意的不對稱,不是疏漏。若「其他」也被封存 —— 照樣用,這條鏈因此保證終止。

## D5:鏡像的身分鍵是 `(user_id, split_expense_id)`,寫法必須是 upsert

不能用 share id:`update` 是**刪光所有 share 再重插一批**(`drizzle-split-expense-repository.ts:185-186`),share id 每次編輯都換一組。

```
finance_transaction
  + split_expense_id uuid null references split_expense(id) on delete cascade
  + category_source text not null default 'manual'
  + unique index (user_id, split_expense_id) where split_expense_id is not null
```

**更新必須寫成 `INSERT … ON CONFLICT … DO UPDATE`,不能沿用 share 的「刪光再插」。**

衝突目標要**重複索引的述詞**(部分唯一索引的規定):`onConflictDoUpdate({ target: [userId, splitExpenseId], targetWhere: sql for split_expense_id is not null, … })`。既有的 `drizzle-finance-budget-repository.ts:51-55` 就是這個形狀。

「只在 `category_source = 'mirror'` 時覆寫 `category_id`」**不能寫成 `DO UPDATE … WHERE`** —— 那會跳過**整列**,連 amount 都不更新。要寫成 SET 清單裡的 `CASE`。 刪光再插會**炸掉 `category_source = 'manual'`**(D6),而且唯一索引擋不住任何東西 —— 那條索引的守門就變成不可能失敗的。

**編輯後不再是分攤者的人,他的鏡像要刪掉**:batch 裡帶一條 `delete … where split_expense_id = ? and user_id not in (…)`。這是集合式的,不需要知道編輯前是誰 —— 重要,因為 adapter **刻意不讀** grouped expense 的舊分攤者(`:182-183`「Only a groupless entry freezes an audience, so a grouped expense never pays for this query」),而那個最佳化不該為了這個 change 死掉。

**batch 裡的語句順序:鏡像的 insert 必須排在 `expenseInsert` 之後。** FK `finance_transaction.split_expense_id → split_expense(id)` 是立即檢查的,排前面就是外鍵錯誤。這個 repo 別的地方對順序寫得很重(`:270`「**ORDER: the insert must come BEFORE the delete, and this is not a style choice**」),這裡也一樣。

**刪除分帳靠 `on delete cascade`,不靠應用層記得。** `delete` 是單一 `db.delete(splitExpense)`(`:326`),資料庫保證比程式碼保證可靠。

## D6:使用者改過分類之後,分帳更新不能蓋回去

`category_source`:`'mirror'`(自動解析的)或 `'manual'`(使用者改過的)。

**兩個方向都要有守門,而且第一版一個都沒有:**

- 鏡像寫入**忘了設 `'mirror'`** → 吃預設值 `'manual'` → `CASE` 永遠不觸發 → **鏡像的分類從此再也不跟著分帳走**。只斷言「使用者改過的被保留」的測試**永遠不會紅**。
- `PUT` **忘了設 `'manual'`** → 使用者的分類在付款人下次編輯時被靜默還原,正是這條規則存在要防的事。而在 PGlite 層寫的那條測試證不了它 —— 那裡的 `'manual'` 是測試自己寫進去的,**從來沒有經過 PUT handler**。`ON CONFLICT DO UPDATE` 只在 `category_source = 'mirror'` 時覆寫 `category_id`;`amount`/`day`/`currency` **無條件**覆寫。

**不要用「分類跟預期值不同就當作使用者改過」來推斷** —— 付款人把分類從餐飲改成娛樂時,那個推斷會誤判成「使用者改過」,然後永遠不再同步。

## D7:鏡像在 finance API 是半唯讀,而 `PUT` 是全取代

`PUT /api/finance/transactions/:id` 是**全取代**(規格:currency「required on full-replace update」)。所以只改分類的客戶端**一定會**送 `amount`、`currency`、`date`。

**規則:amount / date / currency / `type` 值不同才拒絕,不是帶了就拒絕。** 帶了就拒絕會讓「只改分類」這個唯一允許的編輯變成做不到。

比較要正規化:currency 大小寫、date 用同一個 `YYYY-MM-DD` 形式。

**`type` 一定要在鎖住的清單裡。** 第一版列了 amount/date/currency 就以為列完了 —— `PUT` 是全取代而 `type` 是它的一部分,分攤者可以把鏡像翻成 `income`(挑一個收入分類,`update-transaction.ts:34` 會收)。那筆錢就離開支出總額、離開每個預算的 `spent`,變成一筆收入,而分帳那邊還說他欠著 —— **用被允許的編輯路徑,做出這個 change 存在就是要消滅的那種不一致。**

`DELETE` 一律拒絕。**在後端擋** —— 前端在另一個 repo,API 是公開的。

## D8:零元分攤**不產生鏡像**

split 允許零元分攤(`validate-expense-fields.ts:97-99`:「有人在一頓分攤裡真的不欠錢是真實情況」,CHECK 是 `amount >= 0`)。finance 要求 `amount > 0`(`validateTransactionFields:15`),而 `finance_transaction.amount` **沒有 CHECK**,所以繞過應用層的 SQL 插入會靜默寫進一筆 0 元交易。

**不欠錢就是沒花錢,不產生鏡像。**

## D9:結清與墊錢不產生鏡像

`split_settlement` 是還錢,不是花錢。替別人墊錢但沒分攤的付款人沒有花這筆錢(他借出了)。兩條都是 `splitSpendingForUser` 的既有語意,**不要重新發明**。

## D10:白名單外的幣別寫不進 finance

- split:`isValidCurrencyCode` 是 `/^[A-Z]{3}$/`,**任意合法三碼**(註解明說刻意不限制成白名單)
- finance:`SUPPORTED_CURRENCIES` 只有 TWD/USD/JPY/EUR/CNY/KRW/GBP/HKD/AUD/CAD

**泰銖、新幣、越南盾的分帳,鏡像寫不進去。**

放寬 finance 白名單被否決:白名單擋的是小數位數,前端 `finance_money.dart` 對每種幣別有固定位數(TWD/JPY/KRW 是 0 位),未知幣別會用錯的位數顯示金額 —— **比看不到更糟**。收緊 split 也被否決:不限制是寫在註解裡的刻意決定。

**白名單外不產生鏡像,分帳本身照樣寫成功**,並且要**明說**(見 D11)。這條路留下了一個「有些錢還是看不到」的洞,誠實地說:它從「所有分帳」縮到「白名單外幣別的分帳」,而且有東西承載它,不是靜默。

## D11:`GET /api/finance/split-spending` 不能刪

對白名單內的幣別,它的數字**已經包含在** summary 的月支出裡。前端目前把它當獨立的卡,**若有人把它加到月支出上就是真正的重複計算**,而且看起來很合理。

對白名單外的幣別,它是那些錢**在 finance 這一側**唯一的去處(分帳那側 `GET /api/split/expenses` 和 `/api/split/balances` 當然還看得到)。

所以回應要**逐幣別標明是否已計入交易**。不要只寫在文件裡。

## D12:這個 change 改不到趨勢與淨值

第一版的 proposal 寫「記帳列表、summary、預算、警示、趨勢、淨值全部自動一致」。**趨勢與淨值是錯的。**

真正 `SUM(finance_transaction)` 的只有兩處:預算的 `spentSum` 與 `getMonthlySummaryRaw`。`drizzle-networth-repository` 只讀 `finance_networth_account` / `finance_networth_snapshot`,**不讀 `finance_transaction`**。`add-installments` 的 proposal 已經寫過同一件事,而我又寫錯一次。

實際會變一致的是:**記帳列表、summary、預算、警示**。四個,不是六個。

## D13:另一個使用者的動作會寫入、刪除你的帳本

付款人建分帳 → 你的帳本多一筆;付款人刪分帳(`delete-expense.ts:10` 允許 creator 或 payer)→ `on delete cascade` **刪掉你帳本裡一筆真的交易**;付款人改金額 → 你的預算可能被推過門檻並發出通知。

這是這個功能的本質,不是 bug。但**「別人可以動你的帳本」要寫進 Impact**,而且目前沒有任何通知路徑告訴你發生了什麼(分帳動態有,記帳頁沒有)。

## D14:回填**先數再決定**

回填的成本不在 SQL,在**分類解析要再實作一次**,而它在 production 只跑一次、沒有測試會再跑到它。而且它**不能寫成 migration** —— migration 是 `drizzle/*.sql`,拿不到 `SharesMirror`、拿不到任何 JS。要做就是一支一次性腳本走 D2 的 `plan`。

分帳功能目前還沒有人在用。**上線前查 `select count(*) from split_expense`:**

- **是 0** → 整段砍掉,PR 裡寫明「上線時分帳表是空的,沒有回填,新舊界線不存在」
- **不是 0** → 用腳本回填,**不呼叫 `afterWrite`**(否則一次噴出一堆歷史通知),並寫明使用者會看到過去月份的預算 `spent` 變高、summary 變

**不要憑「應該沒有資料」就砍掉。要數過。**

## D15:`test/db` 現在沒有任何 finance 的接線

`harness.ts:116` 的 `TABLES` 一張 finance 表都沒有,`test/db/` 下也沒有建構過任何 finance repository。這個 change 需要在 PGlite 層證明的東西(原子性、upsert、cascade、唯一索引)**全部需要先把那條路接起來**。

好消息:`withBatchShim`(`harness.ts:100-114`)是真的 Postgres 原子性,rollback 本身被 `harness-batch.test.ts` 釘住;部分唯一索引在這個 stack 已經證明可行(`drizzle/0020_daffy_pride.sql:25`)。

## D16:封存群組裡的分帳仍然可編輯,所以仍然會改寫別人的帳本

`update-expense.ts:43` 傳 `checkArchived: false`,規格也明說封存群組裡的支出保持可修正。**這是對的,不改** —— 但它代表封存群組裡的一次編輯照樣會動到別人的 `finance_transaction`。沒寫下來的話會被當成漏洞。
