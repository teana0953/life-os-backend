## Why

分帳(PR #65–#68)已上,但**沒有還款概念**:餘額是全部歷史的淨額,現實中還了錢只能靠再開一筆反向支出充數,明細裡於是混著一堆看不出是花費還是結清的「支出」。同時分帳與個人記帳完全平行,總覽看不到自己在分帳上真正花了多少。本 change 補上兩者,財務藍圖收尾。

使用者裁定:**還款記成獨立紀錄**(不用反向支出充數);**分帳只算「自己那份」進個人統計、不自動建交易**;**算進總覽與趨勢,不算進預算**。

## What Changes

- 新表 `split_settlement`(`group_id` nullable、`from_user_id`/`to_user_id`、`amount`/`currency`/`day`/`note`、`created_by_user_id`),CHECK `amount > 0` 與 **CHECK `from_user_id <> to_user_id`**。
- **餘額公式加上還款,而兩段 SQL 的符號約定相反**:雙人查詢的列主體是**對方**(正 = 對方欠我),群組查詢的列主體是**成員自己**(正 = 該成員是債權人)。同一句「from 就減」套上去會在群組那邊反向,欠款人還完錢顯示欠更多且不報錯。所以**兩段各自的純函式、各自的測試**。
- **方向驗證用有號數值,不用零和**:把加減號整組對調,群組零和照樣成立、測試照樣綠——零和只證明有加也有減,不證明加在誰身上。要對指名成員斷言 net 的正負與數值。
- 新 endpoint:`POST`/`GET`/`DELETE /api/split/settlements`(**不做 PATCH**:三個欄位,記錯刪掉重記比部分更新單純,也少一條要重跑全部驗證的路徑),以及 `GET /api/finance/split-spending?month=`。
- **個人統計整合是唯讀聚合**:`Σ split_share.amount WHERE user_id = me AND 該月`,按幣別分列,**不寫 `finance_transaction`**。付款人自己那份**要算**(他確實花了那筆錢)——與餘額計算刻意排除自己那份相反,因為問的是不同問題。**還款不算支出**(結清既有債務,不是新花費)。
- **預算不受影響**:`checkBudgetAlerts` 仍只在 `createTransaction` 觸發。
- **`/api/finance/summary` 的回應形狀不變**——既有前端已經在讀它,分帳自付額走新的 endpoint,讓前端能分開顯示「記帳支出」與「分帳自付額」而不是混成一個看不出差別的數字。

範圍外:simplify debts(多方債務重組,錯了會動到別人的帳)、還款提醒/通知、「全額結清」的後端特判(前端算好金額送一般還款即可)。

## Capabilities

### New Capabilities

- (無新 capability,兩者都是既有能力的延伸)

### Modified Capabilities

- `split-bills`:還款紀錄、餘額扣抵、還款的授權與可見性。
- `finance-ledger`:新增分帳自付額的月聚合(既有 summary 的回應形狀不變)。

## Impact

- 新增 `src/contexts/split/**` 的 settlement 相關檔、`src/adapters/http/routes/split.ts` 三條路由、`routes/finance.ts` 一條路由。
- 修改 `src/shared/db/schema.ts`(一張表)+ 一份 drizzle migration、`drizzle-balance-repository.ts`(兩段 SQL 都要加還款)、`src/index.ts`(DI)。
- **既有回應形狀零變更**,前端不會被打斷。
- **測試缺口照舊**:餘額聚合改了,而這個 repo 無法在 CI 執行 Drizzle SQL。緩解是把正負號在 application 層用純函式算一次並測、群組零和不變量測到,並留待實機驗。
