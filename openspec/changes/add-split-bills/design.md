# 群組分帳(sub-project 5,後端)— 設計

分帳三部曲的第二步。好友(sub-project 4)已上,這一期是**第一個真的跨使用者寫入**的功能:A 建立的一筆支出會直接在 B 的餘額上長出欠款。現有全部資料都嚴格按 `user_id` 隔離,這裡開始不是了——所以**授權是本 change 的主軸,不是附帶條款**。

## 使用者已裁定

- **不強制開群組**:兩人吃飯直接選人分,旅行/合租這種長期多人才開群組。代價是資料模型要同時支援「有群組」與「無群組」兩種分帳(Splitwise 也是這樣)。
- **分帳是獨立的帳,先不進個人統計**:不碰 `finance_transaction`。藍圖本來就把「分帳整合進個人統計」放在 sub-project 6。
- 沿用全域決策:**多幣別標記不換算**,餘額按幣別分列。

## 範圍

做:群組 CRUD + 成員、分帳支出 CRUD、均分/自訂拆分、按幣別的雙人淨額與群組餘額。
不做:settle up / 還款紀錄(sub-project 6)、與個人記帳連動(6)、匯率換算(全域決策)、收據照片、通知。

## 資料模型

### `expense_group`

- `id` uuid pk / `name` text not null / `created_by_user_id` uuid → `users.id`
- `archived_at` timestamptz nullable(不真刪:刪掉群組等於刪掉別人的帳務歷史)
- `created_at` / `updated_at` timestamptz

### `expense_group_member`

- `id` uuid pk / `group_id` uuid → `expense_group.id` / `user_id` uuid → `users.id`
- `joined_at` timestamptz
- unique `(group_id, user_id)`;index `(user_id)`(「我的群組」要靠它,否則 seq scan)
- **離開群組**:先不做。有未結清餘額時離開是 settle up 的問題,留給 sub-project 6;這一期只有加入(建立者自動成為成員 + 由成員邀既有好友加入)。

### `split_expense`

- `id` uuid pk
- `group_id` uuid **nullable** → `expense_group.id`(null = 一對一/臨時分帳)
- `payer_user_id` uuid not null → `users.id`(誰先墊的錢)
- `created_by_user_id` uuid not null → `users.id`(不一定等於付款人)
- `amount` integer not null(**最小幣別單位**,與 `finance_transaction` 一致)+ `currency` text not null
- `description` text not null / `day` date not null(`YYYY-MM-DD`,與既有慣例一致)
- `split_mode` text not null(`equal` | `exact`)——存下來是為了「編輯時回到原本的輸入方式」,**計算結果一律落地在 `split_share`**,不在讀取時重算(重算會讓歷史金額隨演算法改變而漂移)
- `created_at` / `updated_at`
- index `(group_id)`、`(payer_user_id)`

### `split_share`

- `id` uuid pk / `expense_id` uuid → `split_expense.id` **on delete cascade** / `user_id` uuid → `users.id`
- `amount` integer not null(這個人**該負擔**的金額,最小幣別單位,**非負**)
- unique `(expense_id, user_id)`;index `(user_id)`(餘額查詢的主要入口)
- **不變量:`sum(amount) = split_expense.amount`**。分幾份、怎麼分,寫入時就要對得起來。這條無法用 CHECK 表達(跨列),所以由 application 保證 + 一條專門的測試釘住;寫入用單一批次語句(見下)讓它不會半套。

## 拆分與進位

**均分的餘數必須有確定的歸屬,不能靠浮點數。** 100 分 3 份 = 34/33/33,不是 33.33。演算法:

```
base = amount / n          (整數除法)
rem  = amount % n          (0 <= rem < n)
把多出來的 rem 個最小單位,分給「按 user_id 小寫 canonical 字串排序」的前 rem 個人
```

排序基準釘死成 **UUID 小寫 canonical 字串**,與 `friendship` 的正規化同一套——同樣的參與者集合永遠得到同樣的拆法,重跑不會變。

`exact` 模式由呼叫端直接給每人金額,後端只驗**總和相等且每份非負**;不足或超出一律 400,不自動補差額(自動補會讓使用者以為自己輸入對了)。

## API

```
GET    /api/split/groups                      # 我所屬的群組
POST   /api/split/groups                      # 建立(建立者自動入組)
GET    /api/split/groups/:id                  # 群組詳情 + 成員
POST   /api/split/groups/:id/members          # 加入一位既有好友
DELETE /api/split/groups/:id                  # 封存(archived_at)

GET    /api/split/expenses?group_id=&with=    # 列出:某群組的,或與某人的一對一
POST   /api/split/expenses                    # 建立(含 shares)
GET    /api/split/expenses/:id
PATCH  /api/split/expenses/:id                # 改金額/拆法/描述/日期
DELETE /api/split/expenses/:id

GET    /api/split/balances                    # 我對每個人的淨額,按幣別分列
GET    /api/split/groups/:id/balances         # 群組內每個人的淨額,按幣別分列
```

## 授權(本 change 的核心)

「參與者」的定義一次講清楚:**這筆支出的付款人,或持有 share 的人**。群組支出另外加上該群組的成員。

每一條 endpoint 都要通過**兩層**檢查,缺一不可:

1. **可見性**:呼叫者必須是參與者(群組支出:或該群組成員)。不是 → **404,不是 403**(403 等於告訴對方「這個 id 存在」)。
2. **可寫性**:見下表。

| 動作 | 誰可以 |
|---|---|
| 建立分帳 | **呼叫者本人必須是參與者**(付款人或持有 share);**群組支出**(`group_id` 不為 null):付款人與每個持有 share 的人**都必須是該群組的成員**;**一對一支出**(`group_id` 為 null):都必須是呼叫者本人或呼叫者的好友;否則 400 |
| 編輯/刪除分帳 | `created_by_user_id` 或 `payer_user_id`。**其他分擔人不能改**——他們沒付錢也沒建立,改了等於單方面改別人的帳 |
| 加入群組成員 | 群組現有成員,且被加的人是**加入者的好友**;不能把陌生人拉進來 |
| 封存群組 | `created_by_user_id` |

**「呼叫者必須是參與者」這條是防偽造的關鍵**(proposal review 抓到):少了它,A 可以憑空建立一筆「B 欠 C」的支出、自己完全不在裡面。同樣地,**`payer_user_id` 一定要驗**——它不是備註欄位,是餘額的方向,填任意 uuid 就等於捏造別人的債務。

有了這條,`created_by_user_id` 必然也是參與者,可見性規則不需要再為建立者開特例(初版設計漏了這點,寫完自己讀不回來)。

**編輯要重跑建立時的全部驗證,包含那兩條授權規則。**(proposal review 兩輪都抓到這裡)`PATCH` 不是只換幾個欄位:金額>0、幣別、day、shares 非空無重複、參與者>1、總和相等、每份非負、每個人是好友或同群組成員、**呼叫者編輯後仍必須是參與者**、**`payer_user_id` 一樣要驗**——一條都不能少。

第二輪點名的具體繞法:A(B 與 C 的共同好友)先建立一筆合法的 `payer=B, shares={A:500, C:500}`,再以 `created_by_user_id` 的身分 PATCH 成 `shares={C:1000}`。第一版的重跑清單每一條都會通過(參與者 = {B, C},兩人),於是 A 憑空造出「C 欠 B 1000」而自己不在裡面,而且**改完自己也讀不回來**——正是 create 那條規則要防的事,從 PATCH 走了進來。

**封存那條不在重跑清單裡**——`archived_at` 只擋 `createExpense` 與 `addGroupMember`,不擋既有支出的編輯與刪除(見下面的封存節)。上一輪修正時把它一起塞進 PATCH 的清單,結果跟同一份文件的「封存後既有支出仍可由 creator/payer 修正」自相矛盾,照著做就會把一筆打錯金額的支出永遠凍在封存群組裡、餘額再也修不回來——正是封存那節說要避免的事。

**可變欄位要釘死**:`amount`、`currency`、`description`、`day`、`split_mode`、`payer_user_id`、shares。**`group_id` 與 `created_by_user_id` 不可變**——搬動群組等於把一筆帳搬進另一群人的視野,那不是編輯,是重建。

**每一格都要有測試,而且要有「非參與者拿到 404」的反向測試。** 這是全案第一個跨使用者授權面,漏一條就是別人的財務資料外洩。

### 群組支出的付款人必須是群組成員

「好友**或**同群組成員」這個條件對付款人來說不夠。第二輪抓到的後果有兩層:

- **群組餘額會對不起來。** 群組餘額只加總成員(見下),一個非成員付款人的債權永遠不會被列出,「同一幣別下所有成員淨額相加為 0」這條不變量就是假的。
- **會讓群組成員欠一個他不認識的人。** shares 那邊已經擋住了(必須是同群組成員),付款人這邊卻沒擋。

所以:**`group_id` 不為 null 時,付款人與每個持有 share 的人都必須是該群組的成員**——不是「好友**或**成員」。寫成 OR 的話,G={A,B,C} 裡 A 可以拿群組外的好友 D 當分擔人(`payer=A, shares={B:500, D:500}`),群組成員的淨額加起來就變成 +500,零和不變量一樣是假的,而 3.5b 那條測試若只用成員來算還會綠。`group_id` 為 null(一對一)時,付款人與分擔人是呼叫者或呼叫者的好友即可。

### 跨 context 的好友查詢

「必須是好友」這條規則要讀 `friendship`,但那是 social context 的資料。**在 `split/domain` 定一個自己的 port**:

```ts
interface FriendChecker {
  friendsAmong(userId: string, otherUserIds: string[]): Promise<Set<string>>;
}
```

**一次問一批,不是一人一次**——一筆支出有 n 個分擔人,用 `FriendshipRepository.findFriend` 就是 n 趟 neon-http round trip。實作時務必用 `src/contexts/social/domain/friendship.ts` 的 `normalizePair` 處理 `user_a_id < user_b_id` 的正規化儲存,**不能只查單一方向**。

## 併發與原子性

**不能用交易**:`src/shared/db/client.ts` 用 `drizzle-orm/neon-http`,該 driver 的 session 直接 `throw new Error("No transactions support in neon-http driver")`(sub-project 4 已經踩過這條)。

但這裡跟 accept invite 不同:**建立分帳不需要依讀取結果分支**,只是「插一列 expense + 插 n 列 share」。所以用 **`db.batch([...])`**——它底層是單一 Postgres 交易,非互動式的限制在這裡不成立。做法:

- **expense 的 uuid 在 application 產生**(`crypto.randomUUID()`),不靠 `DEFAULT gen_random_uuid()` 回傳——這樣 shares 的 `expense_id` 在送出前就已知,兩個 insert 可以放進同一個 batch。
- 更新拆分:`batch([delete shares where expense_id = X, insert new shares..., update expense])`,同樣原子。
- 刪除:`on delete cascade` 讓 shares 跟著走,單語句即可。

**不要**寫成「先 insert expense,await,再 insert shares」——中間失敗會留下一筆 `sum(shares) = 0` 的孤兒支出,而餘額是從 shares 算的,使用者看到的是一筆金額對不起來的帳。這是靜默資料損毀。

## 餘額計算

```
我對 X 的淨額(某幣別) =
    Σ (X 是分擔人 且 我是付款人) 的 share.amount      -- X 欠我
  − Σ (我是分擔人 且 X 是付款人) 的 share.amount      -- 我欠 X
```

- **付款人自己那份兩邊都不計入**——不是「互相抵銷」(初版這樣寫,會誤導實作)。算 我↔X 的淨額時,兩個 Σ 都只取**對方**那一列,付款人自己那份從來沒進入任何一邊。**SQL 聚合時要顯式排除 `share.user_id = payer_user_id` 的列**,否則會多出一筆「自己欠自己」的餘額。若付款人不在 shares(純代墊),整筆都是別人欠他,公式一樣成立。
- **按幣別分組,永不相加**。回傳形狀是 `[{ user_id, display_name, balances: [{ currency, amount }] }]`。
- 淨額為 0 的幣別不回(不然清完的關係會一直掛著一堆 0)。
- 用 SQL 聚合算,**不要把所有 share 撈進記憶體再加**——這張表會隨使用時間單向成長。

**群組餘額的定義**(初版沒定義,兩種讀法會算出不同的錢):對群組內每一位成員 m,在**該群組的支出範圍內**,

```
net(m, 幣別) = Σ (m 是付款人的支出上,其他人的 share)      -- 別人欠 m
             − Σ (別人是付款人的支出上,m 的 share)        -- m 欠別人
```

同樣排除付款人自己那份。**同一幣別下所有成員的 net 相加必為 0**——這是一條不變量,要有測試釘住。它成立的前提是**群組支出的付款人必然是群組成員**(見上);少了那條規則,非成員付款人的債權不會被列進來,這條不變量就是假的。回傳的是「每位成員對整個群組的淨額」,不是兩兩配對的矩陣。

### 清單查詢的語意

`GET /api/split/expenses?group_id=&with=`:

- `group_id=<id>`:該群組的支出(我必須是成員,否則 404)。
- `with=<userId>`:**`group_id IS NULL` 且我與對方皆為參與者**的支出——群組支出不會出現在一對一清單裡。
- 兩個同時給 → 400(語意衝突,不猜)。
- 兩個都沒給 → 我參與的全部支出。
- **參與條件一定要寫進 SQL WHERE**(對 `split_share` 用 `EXISTS`),不得先撈全部再在記憶體篩。

## 驗證與邊界(每條都要測)

- `amount <= 0` → 400;`shares` 為空 → 400;同一人在 shares 出現兩次 → 400(unique 也擋,但要回可讀的錯)
- `sum(shares) != amount` → 400,錯誤訊息要說出差多少(使用者才知道要改哪裡)
- 幣別非三碼大寫 → 400;`day` 非 `YYYY-MM-DD` → 400
- 把**非好友**列進 shares → 400(不是 404:呼叫者自己提供的 id,不涉及存在性洩漏)
- 分帳只有自己一個人 → 400(那是個人記帳,不是分帳)
- `group_id` 指向我不是成員的群組 → 404
- shares 裡有人不是該群組成員 → 400
- 改支出時把某人從 shares 拿掉 → 該人的餘額要跟著消失(靠 delete+insert 的原子替換)
- **`archived_at` 不為 null 的群組**——三件事分別定義,不要一律擋(閘門擋錯東西是這專案反覆出現的類型):
  - 可讀(歷史與餘額都還在)
  - **不可**新增支出、**不可**加入新成員
  - **既有支出仍可由 creator/payer 編輯與刪除**——不然封存後一筆打錯金額的支出永遠改不掉,餘額也永遠修不回來

## HTTP 層的兩個現成陷阱

- **錯誤映射要自己寫,不能靠 `onError`。** `app.ts` 既有的 `onError` 只認得 `BadRequestError`(一律回 `error: "bad_request"`),其餘全部 500 internal——use case 丟 `GroupNotFound` 而路由沒有自己的 mapper,拿到的是 **500 不是 404**,本 change 的核心規則就靜默失效了。真正的先例是 `routes/friends.ts` 的 `mapSocialError`:照它寫一個 `mapSplitError`,`onError` 只當未預期錯誤的兜底。
- **uuid 形狀要先驗。** 丟一個非 uuid 字串進 `:id` 或 `shares[].user_id`,會一路打到 Postgres 的 uuid cast(22P02)變成 500。friends 路由已經踩過並留下 `UUID_RE` 先例:路徑參數不合法 → 404,body 內不合法 → 400。

## 明確接受的取捨

- **沒有稽核軌跡**:誰改了什麼、什麼時候改的,只有 `updated_at`。單人自用 app,先不做 `split_expense_history`;若日後真的出現「我沒同意這筆」的爭議再補。
- **沒有數量上限**:群組數、成員數、支出數都不設限,與 friend invite 同一個理由。
- **這一期最危險的兩段 SQL 沒有 DB 級測試**,這是**有意識接受的缺口**(使用者裁定)。這個 repo 所有 `Drizzle*Repository` 測試都用手寫的假 `Db`,它的 `where()` 直接把參數丟掉,兩個 Vitest project 都沒有 Postgres 路徑——也就是說**可見性的 WHERE 子句與餘額聚合都會綠著上線而沒被真的驗過**(好友的 accept CTE 也是同樣處境)。緩解:授權規則在 application 層也擋一次(不是只靠 SQL)。**`listExpenses` 尤其不能只靠 SQL**——第二輪點名:它是唯一一個「錯了就整批洩漏別人支出」的端點,而它的篩選條件按原設計完全活在無法測試的 SQL 裡,等於使用者接受缺口時被告知的緩解措施在最該生效的地方不存在。做法:use case 拿到 repository 回傳的列之後,**再逐列斷言呼叫者確實是參與者**,不是的就丟掉並視為程式錯誤;這條用假 repository 餵一列「呼叫者不在其中」的毒資料就測得到,CI 擋得住。並且**留待實機驗**:用兩個真帳號互相建支出,確認非參與者拿到 404、雙人與群組餘額的數字正確、多幣別分列。若日後要補,PGlite(WASM 版真 Postgres,不需 Docker)是最省事的路。
- **離開群組不做**(見上),**settle up 不做**——沒有還款紀錄,餘額就是全部歷史的淨額。使用者現實中還了錢,這一期只能靠再開一筆反向支出;這很難用,但那正是 sub-project 6 的內容,不在這裡半套實作。
