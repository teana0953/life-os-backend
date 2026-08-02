# Tasks

由內而外,每層有測試才往下一層。授權那一段的每一格都要有「非參與者拿到 404」的反向測試——這是全案第一個跨使用者授權面。

## 1. Schema + migration

- [ ] 1.1 `src/shared/db/schema.ts` 加 `expense_group`(`id`/`name`/`created_by_user_id`/`archived_at` nullable/`created_at`/`updated_at`)
- [ ] 1.2 `expense_group_member`(`group_id`/`user_id`/`joined_at`),unique `(group_id, user_id)`,**index `(user_id)`**(「我的群組」靠它,沒有就 seq scan)
- [ ] 1.3 `split_expense`(`group_id` **nullable** → `expense_group.id`、`payer_user_id`、`created_by_user_id`、`amount` integer 最小幣別單位、`currency`、`description`、`day` date、`split_mode` text、時間戳),index `(group_id)`、`(payer_user_id)`
- [ ] 1.4 `split_share`(`expense_id` → `split_expense.id` **on delete cascade**、`user_id`、`amount` integer),unique `(expense_id, user_id)`、index `(user_id)`,加 **DB CHECK** `check("split_share_amount_non_negative", sql`amount >= 0`)`;`split_expense.amount > 0` 同樣加 CHECK(照 `friendship` 用 check 當 application 紀律後盾的先例)
- [ ] 1.5 `npx drizzle-kit generate` 產 migration 並 commit;**不要手寫 SQL**

## 2. domain

- [ ] 2.1 `src/contexts/split/domain/` 實體:`ExpenseGroup`、`GroupMember`、`SplitExpense`(含 shares)、`SplitShare`、`Balance`
- [ ] 2.2 `errors.ts`:typed error——`GroupNotFound`、`ExpenseNotFound`、`NotAParticipant`、`SharesDoNotSumToAmount`(帶差額)、`NotFriends`、`NotAGroupMember`、`GroupArchived`、`SplitTooSmall`(只有自己一人)、`DuplicateParticipant`
- [ ] 2.3 `split-calculator.ts`:`equalSplit(amount, userIds)` —— 整數除法 + 餘數逐一分給**按 user_id 小寫 canonical 字串排序**的前 n 人。**不得出現任何浮點數運算**
- [ ] 2.4 測試:100/3 = [34,33,33];1/3 = [1,0,0];同一組人同一金額跑兩次結果相同;10 個人分 7 元;總和永遠等於 amount(用一批代表性金額×人數組合掃過)
- [ ] 2.5 `validateExactSplit(amount, shares)`:每份非負 + 總和相等,否則丟 `SharesDoNotSumToAmount`(訊息要說出差多少);**不得自動補差額**
- [ ] 2.6 repository ports:`ExpenseGroupRepository`、`SplitExpenseRepository`、`BalanceRepository`,以及 split 自己的 **`FriendChecker { friendsAmong(userId, otherUserIds): Promise<Set<string>> }`**——「必須是好友」要讀 social 的資料,但用 port 隔開;**一次問一批**,別用 `FriendshipRepository.findFriend` 一人一趟(n 個分擔人就是 n 趟 neon-http)

## 3. application

- [ ] 3.1 群組 use case:`createGroup`(建立者自動入組)、`listMyGroups`、`getGroup`(非成員 → `GroupNotFound`)、`addGroupMember`(被加的人必須是加入者的好友)、`archiveGroup`(限 `created_by_user_id`)
- [ ] 3.2 `createExpense`:驗金額>0、幣別、day、shares 非空且無重複、參與者>1、**呼叫者本人必須是參與者(付款人或持有 share)**、**`payer_user_id` 必須被驗**(**群組支出**:付款人與每個持有 share 的人**都必須是該群組成員**,不是「好友或成員」——寫成 OR 的話可以把群組外的好友塞進 shares,零和不變量一樣是假的;**一對一支出**:都必須是呼叫者本人或呼叫者的好友)——否則群組餘額的零和不變量是假的,而且會讓成員欠一個群組外的陌生人、group 存在且我是成員且未封存;`equal` 走 calculator、`exact` 走 validator
- [ ] 3.2b 反向測試:A 送出一筆「B 付款、C 分擔」而 A 不在裡面 → 400(捏造他人債務);`payer_user_id` 填一個非好友的 uuid → 400
- [ ] 3.3 `updateExpense`:限 `created_by_user_id` 或 `payer_user_id`,其他人 → `ExpenseNotFound`;shares 原子替換。**必須重跑 3.2 的全部驗證,含那兩條授權規則**——金額、幣別、day、無重複、參與者>1、總和相等、每份非負、每個人是好友或同群組成員(群組支出:必須是成員)、**編輯後呼叫者仍必須是參與者**、**`payer_user_id` 一樣要驗(群組支出含成員資格)**。**封存不在重跑清單裡**——`archived_at` 只擋 create 與加成員,擋 PATCH/DELETE 會跟 3.4b 打架、把封存群組裡打錯的金額永遠凍住。**可變欄位釘死**:`amount`/`currency`/`description`/`day`/`split_mode`/`payer_user_id`/shares;**`group_id` 與 `created_by_user_id` 不可變**
- [ ] 3.3b 測試:PATCH 塞入非好友的 share → 400;PATCH 讓總和對不上 → 400 且資料未變;**PATCH 把自己從 shares 拿掉 → 400**(具體繞法:A 先建 `payer=B, shares={A:500,C:500}`,再 PATCH 成 `shares={C:1000}`,憑空造出「C 欠 B」而 A 不在裡面,且自己也讀不回來);**PATCH 改 `group_id` → 400**
- [ ] 3.4 `deleteExpense`(同上授權)、`getExpense`/`listExpenses`(可見性:付款人、分擔人、或群組成員;其他人 → `ExpenseNotFound`)。`listExpenses` 的 `with=<userId>` 語意:**`group_id IS NULL` 且雙方皆為參與者**;`group_id` 與 `with` 同時給 → 400;都沒給 → 我參與的全部
- [ ] 3.4b 封存後的行為分三種,不要一律擋:可讀、**不可**新增支出、**不可**加入成員、**既有支出仍可由 creator/payer 編輯刪除**(否則封存後打錯的金額永遠改不掉);三條各一測
- [ ] 3.5 `getBalances`(我對每個人,雙人淨額)、`getGroupBalances`(群組內**每位成員對整個群組**的淨額,不是兩兩矩陣;定義見 design)
- [ ] 3.5b 測試:同一幣別下群組所有成員的淨額**相加必為 0**(不變量);涵蓋付款人不持 share、多幣別、有成員完全沒參與任何支出、參與者只是成員的子集
- [ ] 3.6 測試:in-memory repository,每個 use case 的正向 + **每一條授權規則的反向**

## 4. adapters(Drizzle)

- [ ] 4.1 `drizzle-expense-group-repository.ts`
- [ ] 4.2 `drizzle-split-expense-repository.ts`。建立/更新用 **`db.batch([...])`**——neon-http **不支援 transaction**(session 直接 throw,sub-project 4 已踩過),但 batch 底層是單一交易,而這裡不需要依讀取結果分支。**expense 的 uuid 在 application 用 `crypto.randomUUID()` 產生**,shares 的 `expense_id` 才能在送出前就已知
- [ ] 4.3 **絕對不要**寫成「先 insert expense、await、再 insert shares」——中間失敗會留下 `sum(shares)=0` 的孤兒支出,而餘額是從 shares 算的,使用者看到一筆對不起來的帳(靜默資料損毀)
- [ ] 4.4 `drizzle-balance-repository.ts`:**用 SQL 聚合**(`GROUP BY` 對方 + 幣別),不得把 share 全撈進記憶體再加;淨額 0 的幣別不回;**顯式排除 `share.user_id = payer_user_id` 的列**,否則會冒出「自己欠自己」
- [ ] 4.5 `listExpenses` 的**參與條件要寫進 SQL WHERE**(對 `split_share` 用 `EXISTS`),不得先撈全部再在記憶體篩
- [ ] 4.5b **但不能只靠那段 SQL**:`listExpenses` 是唯一一個錯了就整批洩漏別人支出的端點,而它的篩選在 CI 裡測不到(見 4.6)。use case 拿到 repository 的結果後**再逐列斷言呼叫者確實是參與者**,不是的就丟掉並當成程式錯誤處理。**這條斷言必須把群組成員也算作參與者**,否則會靜默丟掉呼叫者本來就看得到的群組支出。這條用假 repository 餵一列「呼叫者不在其中」的毒資料就測得到——**要有這個測試**
- [ ] 4.6 **已知缺口,不要假裝有測到**:這個 repo 所有 `Drizzle*Repository` 測試都用手寫假 `Db`,它的 `where()` 直接丟掉參數,兩個 Vitest project 都沒有 Postgres 路徑——可見性 WHERE 與餘額聚合**無法在 CI 驗證**。使用者已裁定接受此缺口。緩解:**授權在 application 層也擋一次**(不是只靠 SQL),並在 PR 的「留待實機」寫明要用兩個真帳號驗非參與者 404、雙人與群組餘額數字、多幣別分列

## 5. HTTP

- [ ] 5.1 `src/adapters/http/routes/split.ts`:群組五條 + 支出五條 + 餘額兩條(路徑見 design)
- [ ] 5.2 在 `routes/split.ts` 寫 **`mapSplitError`**,照 `routes/friends.ts` 的 `mapSocialError` 先例:可見性失敗一律 **404 `not_found`**(**不是 403**),驗證失敗 400 + 各自可區分的 `error` 碼。**不能靠 `app.ts` 的 `onError`**——它只認得 `BadRequestError`(一律回 `bad_request`),其餘全部 500,`GroupNotFound` 丟上去會變成 500 而不是 404,核心規則靜默失效
- [ ] 5.2b 所有 `:id` 路徑參數與 body 內的 user id 先過 **`UUID_RE`**:路徑不合法 → 404,body 不合法 → 400。不然非 uuid 字串會打到 Postgres 的 uuid cast(22P02)變成 500(friends 路由已有此先例)
- [ ] 5.3 **註冊順序**:`/api/split/groups/:id/members` 要在 `/api/split/groups/:id` 之前,`/api/split/expenses/...` 同理(friends 路由已有這個先例與註解)
- [ ] 5.4 `src/index.ts` DI 接線,含 `FriendChecker` 的 Drizzle 實作
- [ ] 5.5 測試:每條 endpoint 的 happy path、401、以及**非參與者拿 404** 的反向測試

## 6. 收尾

- [ ] 6.1 `npm run typecheck`、`npm test` 全綠
- [ ] 6.2 檢查沒有任何 endpoint 回 403(可見性一律 404)——用 grep 確認,不只靠測試
- [ ] 6.3 檢查沒有任何 split 的 not-found 路徑會落到 `onError` 的 500
