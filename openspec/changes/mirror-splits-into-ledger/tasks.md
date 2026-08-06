# Tasks

**這個 change 的賣點是一致性,所以每一個守門都要能抓到「兩邊對不上」。** 抓不到那個的測試,不管綠不綠,都不算數。

## 0. 先決定,再動手

- [ ] 0.1 `split-into-budget` **已刪除**。確認 repo 裡沒有殘留的 `SplitSpentLookup`、`includes_split` —— 留著任何一個,分帳就會被算兩次。
- [ ] 0.2 **數 `select count(*) from split_expense`**(D6)。是 0 就把第 9 節整段砍掉並寫進 PR;不是 0 就照第 9 節做。**要真的數,不要憑印象。**

## 1. Schema

- [ ] 1.1 `finance_transaction` 加 `split_expense_id uuid null references split_expense(id) on delete cascade`。
- [ ] 1.2 **部分唯一索引** `(user_id, split_expense_id) where split_expense_id is not null`。**不要**用 share id 當鍵 —— `update` 是刪光 share 再重插,id 每次都換(D1)。
- [ ] 1.3 加 `category_source text not null default 'manual'`。
- [ ] 1.4 **突變:把唯一索引拿掉,一個「同一筆分帳被編輯兩次」的測試必須紅**(否則會長出第二筆鏡像)。

## 2. 原子性 —— 這是最容易靜默壞掉的地方

- [ ] 2.1 鏡像的 insert/update/delete **加進 split adapter 既有的 `db.batch`**,不是 batch 之後(D2)。
- [ ] 2.2 **突變:把鏡像那幾條語句搬到 `await db.batch([...])` 之後、用第二次 await 寫**,再讓那次寫入丟錯 —— 必須有測試紅在「分帳存在但鏡像不存在」。
- [ ] 2.3 **這條測試要在 PGlite 的 DB 測試裡寫**(`test/db/`),不是用 fake repo。fake 沒有 batch,證明不了原子性。

## 3. 分類解析(D3)

- [ ] 3.1 照名字對到參與者自己的分類 → 退到「其他」 → 都沒有就先 seed。
- [ ] 3.2 **突變:拿掉 seed 那一步**,一個「參與者從沒開過記帳頁」的 fixture 必須紅(`category_id` 是 NOT NULL,會寫不進去)。fixture 要真的讓那個使用者**一個分類都沒有**,不能先呼叫 `GET /api/finance/categories`。
- [ ] 3.3 **突變:改成用付款人的 `category_id`**,一個「兩人分類 id 不同但同名」的 fixture 必須紅。分類是 per-user 的,共用 id 會踩到別人的分類或外鍵錯誤。
- [ ] 3.4 封存分類:鏡像照用,**而 `POST /api/finance/transactions` 選同一個分類仍然被拒**(`create-transaction.ts:28`)。**兩件事在同一條測試裡斷言** —— 只斷言其中一件的話,「乾脆把 create 的封存檢查拿掉」這個突變會活下來。

## 4. 不覆蓋使用者改過的分類(D4)

- [ ] 4.1 分帳更新只覆寫 `category_source = 'mirror'` 的鏡像。
- [ ] 4.2 **突變:無條件覆寫**,一個「使用者改了分類 → 付款人改金額 → 分類必須不變、金額必須變」的測試必須紅。**金額那半要一起斷言** —— 只斷言分類沒變的話,「乾脆什麼都不更新」這個突變會活下來。

## 5. 鏡像在 finance API 是半唯讀(D5)

- [ ] 5.1 `split_expense_id is not null` 的交易:拒絕改 amount/date/currency,拒絕 delete;允許改 category/note(並把 `category_source` 設成 `'manual'`)。
- [ ] 5.2 **在後端擋,不是只把前端按鈕藏起來。** 前端在另一個 repo,API 是公開的。
- [ ] 5.3 **突變:只擋 delete 不擋 update**,必須有測試紅。反之亦然。**兩個方向都要有斷言。**

## 6. 白名單外的幣別(D10)

- [ ] 6.1 白名單外不產生鏡像。**分帳本身照樣寫成功**,不要因為鏡像寫不了就整筆失敗。
- [ ] 6.2 **突變:讓白名單外的分帳整筆失敗**,一個 THB 分帳的測試必須紅。
- [ ] 6.3 `GET /api/finance/split-spending` 每個幣別標明是否已計入交易。**突變:把標記寫死成同一個值**,一個同時有 TWD 與 THB 分帳的測試必須紅(只測其中一種幣別的話,常數會活下來)。

## 7. 結清與墊錢(D7、D8)

- [ ] 7.1 結清不產生鏡像;墊錢但沒分攤的付款人不產生鏡像。
- [ ] 7.2 **突變:讓付款人拿到全額鏡像**,一個「A 付 1800、A 分攤 900」的測試必須紅(斷言 A 的鏡像是 900 不是 1800)。
- [ ] 7.3 結清那條:既有的 `finance.test.ts:678` 只釘住 split-spending 端點。**這個 change 要新增一條斷言結清之後使用者的交易數量不變** —— 端點那條擋不住「結清也產生鏡像」。

## 8. 三個 issue 一起關

- [ ] 8.1 **#75**:一條測試斷言分帳之後總預算與分類預算的 `spent` 都變了。
- [ ] 8.2 **#76**:一條測試斷言分帳跨過 80% 時**真的送出推播**(用既有的 `FakeBudgetAlertNotifier`)。**這是這個 change 相對 `split-into-budget` 最大的差別,一定要有。**
- [ ] 8.3 **#77**:一條測試斷言 summary 的月支出與總預算的 `spent` 是同一個數字。

## 9. 回填(**只在 0.2 數出來不是 0 時才做**)

- [ ] 9.1 migration 為既有分帳補鏡像,分類走同一條解析規則。
- [ ] 9.2 **不觸發預算警示。** 突變:讓回填走一般的建立路徑,一個「回填後 notifier 沒有任何訊息」的斷言必須紅。
- [ ] 9.3 白名單外的幣別跳過。
- [ ] 9.4 **可重跑**(唯一索引擋住重複),PR 裡寫明使用者會看到過去月份的數字變高。

## 10. 驗證

- [ ] 10.1 `npm test`、`npm run typecheck` 全綠。
- [ ] 10.2 既有測試若因為「分帳現在會產生交易」而失敗,**逐條判斷是合法的預期變化還是真的弄壞了**。`finance.test.ts:642`(summary 不受分帳影響)與 `:807` 都會反轉 —— 那是對的,不要用改斷言的方式繞過。
