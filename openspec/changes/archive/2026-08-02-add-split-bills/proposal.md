## Why

好友(PR #64)已上,但好友目前什麼也做不了——分帳才是當初要好友的理由。本 change 做 sub-project 5 的後端:群組、分帳支出、拆分、按幣別餘額。

這是全案**第一個真的跨使用者寫入**的功能:A 建立的一筆支出會直接在 B 的餘額上長出欠款。現有所有資料都嚴格按 `user_id` 隔離,這裡開始不是了,所以授權是本 change 的主軸而不是附帶條款。

使用者裁定:**不強制開群組**(兩人吃飯直接選人分,旅行/合租才開群組);**分帳是獨立的帳,不碰 `finance_transaction`**(整合進個人統計是 sub-project 6)。

## What Changes

- 新 bounded context `src/contexts/split/`(domain / application / adapters),照 `contexts/social/` 佈局。
- 四張表:`expense_group`、`expense_group_member`、`split_expense`(`group_id` **nullable** = 一對一分帳)、`split_share`(每人該負擔的金額,`on delete cascade`)。
- 拆分:`equal`(整數除法 + 餘數按 **user_id 小寫 canonical 字串排序**分給前 n 人,確定性,不用浮點數)與 `exact`(呼叫端給金額,後端只驗總和相等且非負)。計算結果**落地在 `split_share`**,讀取時不重算。
- 餘額:按幣別分列的雙人淨額與群組餘額,**用 SQL 聚合**、永不跨幣別相加、淨額 0 的幣別不回。
- 授權兩層:可見性(非參與者一律 **404 不是 403**)+ 可寫性(編輯/刪除限建立者或付款人;列入 share 的人必須是好友或同群組成員)。
- 原子性用 **`db.batch([...])`**(neon-http 不支援 transaction,但 batch 底層是單一交易且這裡不需要依讀取結果分支);expense 的 uuid 在 application 產生,好讓 expense 與 shares 進同一個 batch。

範圍外:settle up / 還款紀錄、與個人記帳連動(皆 sub-project 6)、匯率換算(全域決策)、離開群組、稽核軌跡、收據照片、通知。

## Capabilities

### New Capabilities

- `split-bills`:群組與成員、分帳支出 CRUD、均分/自訂拆分、按幣別餘額,以及涵蓋以上全部的跨使用者授權規則。

## Impact

- 新增 `src/contexts/split/**`、對應測試、`src/adapters/http/routes/split.ts`。
- 修改 `src/shared/db/schema.ts`(四張表)+ 一份 drizzle migration、`src/adapters/http/app.ts`(路由註冊)、`src/index.ts`(DI)。
- **不修改** friends / finance 既有的任何行為;分帳讀 `friendship` 做授權,但不寫它。
- 前端零改動(sub-project 5 的前端另開 change)。
