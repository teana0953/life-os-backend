# Design

## D0:`split-into-budget` 已作廢,由這個 change 取代

`split-into-budget` 讓 `listBudgetsWithProgress` 與 `checkBudgetAlerts` 各自去查一次分帳自付額。這個 change 讓自付額**變成一筆真的交易**,而 `spentSum` 本來就會撈到它。

**兩套同時存在 = 每一筆分帳被算兩次。** `split-into-budget` 已經刪掉(2026-08-06),它做的是「查詢時多加一個來源」,只修了總預算,而且明說分類預算、警示(#76)、summary(#77)都還是假的。

順帶:`split-into-budget` 有一半的複雜度來自「分類預算不含分帳」(`includes_split` 欄位、D3 的界線)。鏡像有分類,**那個界線消失了** —— 餐飲預算會真的看到跟人分的餐費,而那正是使用者要的。

## D1:鏡像的身分鍵是 `(user_id, split_expense_id)`,**不是 share id**

直覺會想用 `split_share_id` 當外鍵。**不行**:`DrizzleSplitExpenseRepository.update` 是**先刪光所有 share 再重插一批**(`drizzle-split-expense-repository.ts` 的 `deleteShares` + `insertShares`),所以 share 的 id **每次編輯都會換一組**。用 share id 當鍵,任何一次編輯都會讓鏡像變成孤兒,而且不會有任何東西發現。

```
finance_transaction
  + split_expense_id uuid null references split_expense(id) on delete cascade
  + unique (user_id, split_expense_id)    -- 部分索引,split_expense_id not null 時才管
```

`on delete cascade` 讓「刪分帳 → 刪鏡像」由資料庫保證,不靠應用層記得。

## D2:鏡像必須進**同一個 `db.batch`**,代價是一個 adapter 同時碰兩個 context 的表

`drizzle-orm/neon-http` **沒有 `transaction()`**,`db.batch` 是唯一的原子單位(`drizzle-split-expense-repository.ts:82-92` 的註解已經寫了這件事)。

鏡像若在 batch 之外寫,失敗就是**永久漂移**:分帳頁有這筆、記帳頁沒有,而且沒有東西會去修。這個 change 的整個賣點是一致性,**漂移不能靠「之後再對帳」補**。

所以:**分帳的 create / update / delete batch 裡要帶上 `finance_transaction` 的語句。**

**這違反 CLAUDE.md 的 context 不互相 import。** 這是一個**刻意的例外**,不是疏忽,理由是原子性只能在單一 batch 裡拿到。要做的是把例外**縮到一個地方**:

- 新增 `src/contexts/finance/domain/ledger-mirror.ts`,定義鏡像那幾條語句要寫什麼(純資料,不含 SQL)
- 由 split 的 adapter 把它翻成語句加進 batch
- **不要**讓 split 的 **application** 層知道 finance 的存在

替代方案(DB trigger)被否決:migration 寫得出來,但測試看不到它,而這個 change 最需要被測試釘住的正是「編輯之後兩邊還一致」。

## D3:分類是**按名字**對到參與者自己的分類,而「他一個分類都沒有」是真的會發生

付款人建分帳時選一個分類(**他自己的** `finance_category.id`)。每個參與者的鏡像要用**他自己的**同名分類 —— 分類是 per-user 的,id 不能共用。

解析順序,**必須保證終止** —— `category_id` 是 NOT NULL,解不出來就是寫不進去:

1. 參與者有**同名**的 expense 分類 → 用它
2. 沒有同名 → 用他的「其他」
3. **他一個分類都沒有** → 先 seed 預設分類,再回第 2 步

第 3 點不是防禦性程式碼,是真的會發生:`ensureDefaultCategories` 只在 `GET /api/finance/categories` 被呼叫,而且**只在使用者一個分類都沒有時才 seed**。一個從沒開過記帳頁的朋友被拉進分帳,他的 `finance_category` 是空的。**分頁載入順序決定了資料能不能寫進去。** seed 要 idempotent(`insertDefaultsIfMissing` 已經是)。

### 鏡像**可以**落在封存的分類上,一般的建立不行

`create-transaction.ts:28` 明確擋封存分類(`if (category.archived) throw new FinanceCategoryArchived()`)。鏡像**刻意不套這條**。

理由是兩者性質不同:一般建立是**使用者在選**,擋住是為了不讓封存的東西回到選單;鏡像**不是選擇**,而擋住的代價是**一筆真的花掉的錢寫不進去**。

這是一個真的不對稱,不是疏漏。**寫進規格,並且要有測試釘住**:參與者把「餐飲」封存之後,鏡像仍然落在「餐飲」上,而 `POST /api/finance/transactions` 選同一個分類仍然被拒。

若「其他」也被封存 —— 照樣用。這條鏈因此保證終止。

## D4:使用者改過分類之後,分帳更新**不能**蓋回去

```
+ category_source text not null default 'manual'   -- 'manual' | 'mirror'
```

分帳更新時,只覆寫 `category_source = 'mirror'` 的那些。使用者一改,變成 `'manual'`,之後分帳再怎麼改都不動它的分類。

**不要用「分類跟預期值不同就當作使用者改過」來推斷** —— 付款人把分類從餐飲改成娛樂時,那個推斷會把「使用者沒改過」誤判成「改過」,然後永遠不再同步。

## D5:鏡像在記帳頁的可編輯範圍

- **金額、日期、幣別:鎖住。** 那是分帳的事實,在這裡改只會讓兩頁對不上,而且改了要往回寫進分攤是另一個功能。
- **分類、備註:可改**(見 D4)。
- **刪除:鎖住。** 刪鏡像不會讓錢消失,只會讓記帳頁再次說謊。要刪去分帳頁刪。

後端要**拒絕**對 `split_expense_id is not null` 的交易做金額/日期/幣別的修改與刪除,回 400/409。**不能只靠前端把按鈕藏起來** —— API 是公開的,而且前端在另一個 repo。

## D6:回填**先數再決定**,不要為零筆資料寫解析邏輯

回填的成本不在 SQL,在**分類解析要在 migration 裡再實作一次**(同名 → 其他 → 一個分類都沒有就先 seed,見 D3)。那是這個 change 最容易寫錯的一段,而它在 production 只跑一次、沒有測試會再跑到它。

而目前**分帳功能還沒有人在用**。

**決定:上線前查 `select count(*) from split_expense`。**

- **是 0** → 整段回填砍掉,PR 裡寫明「上線時分帳表是空的,所以沒有回填,新舊界線不存在」。
- **不是 0** → 回填,並寫明使用者會看到什麼:過去月份的預算 `spent` 變高(可能變成超支)、summary 月支出變、趨勢圖歷史線整條抬高。**這不是 bug,是把一直都在的支出補記上去。**

不管哪一種,**回填都不觸發預算警示** —— 那會一次噴出一堆歷史通知。

**不要憑「應該沒有資料」就砍掉。** 要數過。

## D7:結清仍然不是支出,鏡像也不碰它

`split_settlement` 是還錢,不是花錢。**不產生鏡像。** 這條規則已經在 `splitSpendingForUser` 裡,不要因為改成鏡像而重新發明它。

## D8:付款人若沒有分攤,就沒有鏡像

替別人墊錢的人不持有 share。他沒有花這筆錢(他借出了這筆錢),所以**沒有鏡像**。這跟 `splitSpendingForUser` 現行語意一致。

## D10:白名單外的幣別**寫不進 finance**,這不是邊緣情況

- split:`isValidCurrencyCode` 只要求**任意合法三碼**(`contexts/split/domain/currency-code.ts`,註解裡明說「不像 finance,split 不限制成固定白名單」)
- finance:`SUPPORTED_CURRENCIES` 只有 **TWD/USD/JPY/EUR/CNY/KRW/GBP/HKD/AUD/CAD** 十種

**泰銖、新幣、越南盾的分帳,鏡像寫不進去。** 對一個會去東南亞的使用者,這不是理論問題。

三條路:

1. **放寬 finance 白名單** —— 否決。白名單擋的是小數位數:前端 `finance_money.dart` 對每種幣別有固定的小數位,TWD/JPY/KRW 是 0 位。未知幣別會用錯的位數顯示金額,**那是比看不到更糟的錯**。
2. **收緊 split 到 finance 的白名單** —— 否決。split 不限制是**寫在註解裡的刻意決定**,而且既有資料裡可能已經有白名單外的幣別,收緊會讓它們變成改不動的死資料。
3. **白名單外的幣別不產生鏡像**,並且**明說**。採用。

代價要誠實:**這條路留下了一個「有些錢還是看不到」的洞** —— 正是這個 change 要修的那種。差別在於它從「所有分帳」縮到「白名單外幣別的分帳」,而且**有東西承載它**(見 D9),不是靜默。

## D9:`GET /api/finance/split-spending` 不能刪,它變成 D10 那個洞的出口

原本以為這個端點會變成純重複資訊。**不對** —— 它是**唯一**會報出白名單外幣別分帳的地方,D10 之後它是那些錢的唯一去處。

但對白名單內的幣別,它的數字**已經包含在** summary 的月支出裡了。前端目前把它當成一張獨立的卡,**若有人把它加到月支出上,就是真正的重複計算**,而且會看起來很合理。

所以回應要**逐幣別標明是否已計入交易**(白名單內 = 已計入,白名單外 = 沒有),讓前端有辦法分開顯示「其中分帳佔多少」與「這些完全沒進記帳」。

**不要只在文件裡寫。**
