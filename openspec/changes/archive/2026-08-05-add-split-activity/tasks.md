# Tasks

**這個 change 有兩個「錯了會很嚴重」的地方,不是功能面**:可見範圍寫錯會**洩漏別人的資料**;原子性寫錯會讓時間軸**漏記或謊報**。功能本身(存一列、讀出來)很簡單。

## 0. 盤點

- [x] 0.1 逐檔確認八個寫入用例與它們的 repository 方法。**已知(review 逐檔驗過)**:只有 3 個用 batch(expense create `:106` / update `:165`、group create `:56`),其餘 **5 個是單列寫入**(expense delete `:171`、settlement create `:48` / delete `:80`、group archive `:74` / addMember `:83`)。第一版說「只有 settlement create 是單列」是錯的。**仍然自己再數一次**——這個 change 的盤點已經錯過一次,而這個 session 錯過五次。
- [x] 0.2 確認 `deleteExpense` / `deleteSettlement` 在刪除前拿得到要快照的欄位(`deleteExpense` 目前會先 `findById`;`deleteSettlement` 要自己看)。拿不到就得先讀再刪,**那也要在同一個 batch 裡**。

## 1. 表與快照

- [x] 1.1 `split_activity` migration。欄位至少:`id`、`actorUserId`、`type`、`groupId`(nullable)、`createdAt`,以及顯示所需的快照欄位。
- [x] 1.2 **快照欄位放結構化欄位還是 jsonb?做決定並寫理由。** jsonb 彈性但查不動也驗不了型別;固定欄位型別安全但每種事件用到的欄位不同。schema 裡已經有 `jsonb` 的先例,看它為什麼那樣選。
- [x] 1.3 **不要**用外鍵指向 `split_expense` / `split_settlement`:那些列會被刪掉,而這張表存在的理由正是它們會消失。`groupId` 可以有外鍵(群組不刪只封存)——**確認這一點**再決定。

## 1b. 受眾:有群組用活的、無群組凍結

- [x] 1b.1 **無群組**的活動要存 `audience_user_ids`(或子表)。**這不是最佳化,是正確性**:參與者存在 `split_share`,刪除時 cascade 掉,事後無法判斷該給誰看。
- [x] 1b.1b **有群組**的活動**不要凍結受眾**,查詢時用該群組的現任成員。群組不會被刪除,而 `listForUser` 本來就用活的成員資格——凍結會讓時間軸和支出列表對「我是不是這個群組的人」給出兩種答案。
- [x] 1b.2 **actor 一定要在受眾裡**。`created_by` 沒有出現在任何一條可見範圍規則中,漏掉的話操作者看不到自己做的事。
- [x] 1b.3 八種事件的受眾**各自寫清楚**。第一版只定義了五種,缺:建立群組、封存群組、修改支出。
- [x] 1b.4 後來才加入的群組成員**看得到**之前的活動(跟他看得到之前的支出一致);無群組的活動他**看不到**(他本來就不是參與者)。這是 1b.1/1b.1b 的直接結果,不是另一個決定。
- [x] 1b.5 **`update-expense` 的受眾是改前 ∪ 改後的參與者聯集。** 它會整組換掉 shares;只取改後的話,**被移出的人永遠不會知道**——而那正好改變他欠多少。**寫一條測試釘住這件事。**

## 2. 原子性 —— 先寫測試

- [x] 2.1 **替 `test/db/harness.ts` 加一個 `batch` shim**(`BEGIN` → 依序執行 → `COMMIT`,任一失敗 `ROLLBACK`)。PGlite 是單連線,所以做得到。harness 的 doc 說的是「pglite driver 沒有 `batch`」,不是「無法原子」——第一版把它讀成後者,寫了「原子性沒地方測」,**那是錯的**。shim 要註解說明它模擬 neon-http 的非互動式 `db.batch`,與正式環境不是同一個實作(這是 harness 既有三條界線的第四條)。
- [x] 2.2 **原子性用 PGlite 對真 Postgres 驗**:讓 batch 裡的第二個語句失敗,斷言第一個也沒留下。假 `Db` 的結構性斷言(兩個語句在同一次 `batch` 呼叫裡)可以留作第二層,但不是主要證據。
- [x] 2.3 **五個單列寫入改成 batch**(expense delete、settlement create/delete、group archive/addMember)。改完既有測試必須全綠——它們是回歸釘子。
- [x] 2.3b **幽靈活動**:expense delete 與 settlement delete 現在是「先讀確認存在,再寫」,並發雙重刪除下 DELETE 命中 0 列、呼叫端拿到 404,**而活動照樣寫進去**。改成把存在性併進同一個語句(`INSERT ... SELECT ... WHERE EXISTS`;drizzle 0.45.2 的 `insert().select()` 回傳 `RunnableQuery`,可以進 batch)。
- [x] 2.3c **`archive` 也需要條件化,但條件不是「列還在」。** 群組永遠不會被刪除(這正是 1.3 拿來論證外鍵安全的前提),所以 `WHERE EXISTS` 確實守的是到不了的狀態——**但 `archived_at` 是單向的,而重複封存到得了**:`where id = ?` 仍然命中已封存的群組,連按兩下就讓時間軸說這個群組被封存了兩次。改成 `where ... and archived_at is null`(update 與 insert 都要),於是活動的 insert 也跟著條件化,第二次呼叫什麼都不寫並回傳 false。**測試同樣寫在 repository 層**(理由同 2.3e:use case 先 `findById`,分不出已封存與剛封存)。
- [x] 2.3d **順序陷阱,要寫進程式碼註解**:條件化的 insert **必須排在 delete 之前**。排在後面的話,同一交易裡它看到列與 cascade 掉的 shares 都已消失,於是**永遠靜默地什麼都不寫**,而「沒有列」那類測試還是綠的。
- [x] 2.3e **測試要寫在 repository 層,不是 use case 層。** use case 會先 `findById` 並在那裡就拋錯,所以「對已消失的目標發刪除」永遠走不到 repository —— 那樣的測試**無條件 insert 也照樣通過**,是一條不可能失敗的守門(第一版就是這樣寫的)。
- [x] 2.4 八種事件**每一種**都要有測試證明同生共死,不是只測一種。

## 3. 可見範圍 —— 用 PGlite 對真 Postgres 驗

- [x] 3.1 查詢寫在哪一層、用什麼 SQL,寫下來。這是**手寫 SQL**,而純函式測試不證明 SQL 抄對(見 `test/db/harness.ts` 的界線說明)。
- [x] 3.2 **在 `test/db/` 寫測試**,用 PR #71 的 PGlite harness。fixture 必須有多樣性:**兩個群組、兩種幣別、兩個不同的人扮演不同角色**。這個 repo 的餘額查詢就是因為 fixture 全部只有一個群組/一種幣別,導致「範圍存在卻不指定群組」「幣別欄存在卻寫死」這類突變全部存活。
- [x] 3.3 **明確一條「非參與者看不到」**。這是資料洩漏的守門,不是功能測試。
- [x] 3.4 **八種事件的可見範圍各一條**(1b.3 要求八種,第一版這裡只寫五種):建立/修改/刪除支出、建立/刪除還款、建立群組、加成員、封存群組。
- [x] 3.5 **對每個述詞問**:有沒有一種 fixture,讓錯誤但非空的答案仍滿足全部斷言?有的話那條就沒被覆蓋。

## 4. 事件內容

- [x] 4.1 八種事件各記什麼,列出來。
- [x] 4.2 `update-expense` 要存**改前/改後的金額**。只寫「修改了」等於沒說。**金額沒變也照存**(不是「有變才存」):讓讀者自己比對兩個數字,`previous_amount != null` 不是「金額變了」的旗標。
- [x] 4.3 描述與參與者的變更**這次不做**,寫進 follow-up。
- [x] 4.3b **還款要存方向**(`actor_is_payer`:actor 是付錢的那一方嗎)。actor、counterpart、金額三個欄位在兩個相反方向下完全一樣,而 `settlement_deleted` 寫入時被記錄的那一列正要消失,**事後沒有第二個地方問得到**。存成相對於 actor 的一個布林,而不是拆成兩種 type:同一列要同時服務兩造(D5),actor 照著讀、counterpart 反過來讀。兩條寫入路徑都已經確保 actor 是兩造之一;不是的話寫 NULL,由 DB 的 CHECK 擋下來,而不是存一個看起來很合理的謊。
- [x] 4.4 存 `actorUserId`,**不存「你」**。「你新增了」vs「A 新增了」是前端依讀者渲染的,後端不做這個判斷。

## 5. 端點

- [x] 5.1 查詢端點:回傳依可見範圍過濾、時間倒序的時間軸。
- [x] 5.2 分頁怎麼做?**做決定並寫理由**(這條時間軸會無限成長)。
- [x] 5.3 回傳的 shape 要讓前端能渲染「你/別人」的差異,而不需要再打一次 API 問「我是誰」。

## 6. 驗證

- [x] 6.1 `npm test`、`npm run typecheck` 全綠。
- [x] 6.2 **不可宣稱可見範圍已驗證**,除非 3.2–3.5 都做到而且突變過。


---

## 決策與盤點結果(apply 時填)

### 0.1 盤點(重新逐檔數過,與 review 的結論一致)

| 用例 | repository 方法 | 改前 |
|---|---|---|
| create-expense | `DrizzleSplitExpenseRepository.create` | **已 batch**(`:106`) |
| update-expense | `DrizzleSplitExpenseRepository.update` | **已 batch**(`:165`) |
| delete-expense | `DrizzleSplitExpenseRepository.delete` | 單列(`:172`) |
| create-settlement | `DrizzleSettlementRepository.create` | 單列(`:51`) |
| delete-settlement | `DrizzleSettlementRepository.delete` | 單列(`:81`) |
| create-group | `DrizzleExpenseGroupRepository.create` | **已 batch**(`:56`) |
| add-group-member | `DrizzleExpenseGroupRepository.addMember` | 單列(`:84`) |
| archive-group | `DrizzleExpenseGroupRepository.archive` | 單列(`:75`) |

**3 個已 batch、5 個要改,與文件一致。**(文件寫的行號是方法宣告行,實際語句在其下一兩行。)

**port 簽章只改了 5 個,不是 8 個。** `create` 三條的 actor 就是 `createdByUserId`,已經在 input 裡,多加一個參數會是重複的真相來源。改的是 `expense.update`/`expense.delete`/`settlement.delete`/`group.archive`/`group.addMember`。

### 0.2 快照欄位

`deleteExpense`/`deleteSettlement` 都不需要「先讀再刪」:活動用
`INSERT ... SELECT ... FROM split_expense/split_settlement WHERE id = ?`,
快照直接從被刪的那一列取,存在性檢查與寫入是同一句。

### 1.2 結構化欄位,不是 jsonb

schema 既有的 jsonb 先例(`vitals.bp_readings`)是**沒有述詞會查的重複子紀錄清單**;
這裡是固定幾個純量,而且 `audience_user_ids` **必須進得了 WHERE**——那正是整張表的重點。
jsonb 會讓可見範圍的述詞既無型別也無法索引。

### 1.3 外鍵

`group_id` **有**外鍵(群組只封存不刪除,`ExpenseGroupRepository` 沒有 delete);
`subject_id` **沒有**外鍵(指向的正是會消失的列);
`actor_user_id`/`counterpart_user_id` 有(使用者不刪)。
同一條理由也決定了**群組名不凍結、查詢時 join**:會 cascade 的才凍結,不會消失的用 join。

### 1b.1 受眾:欄位而非子表

`audience_user_ids uuid[]`。理由:刪除路徑的條件化 insert 必須在**同一句 SQL** 裡把受眾算出來
(`array_agg(distinct ...)`),子表要第二句、也要同樣的排序紀律;而讀取端只需要 `= ANY(...)`。
CHECK `(group_id is null) <> (audience_user_ids is null)` 把 XOR 釘在 DB 層:
兩者皆空 = 誰都看不到(靜默漏掉一筆異動),兩者皆有 = 兩個互相矛盾的答案。

### 1b.3 / 4.1 八種事件的受眾與內容

| type | group_id | 受眾 | 記什麼 |
|---|---|---|---|
| `expense_created` | 支出的群組 | 有群組:現任成員;無群組:actor ∪ payer ∪ shares | amount, currency, description |
| `expense_updated` | 同上 | 無群組:actor ∪ **改前** ∪ **改後** 參與者 | amount, **previous_amount**, currency, description |
| `expense_deleted` | 同上 | 無群組:actor ∪ payer ∪ shares(SQL 內算,刪除前) | amount, currency, description |
| `settlement_created` | 還款的群組 | 無群組:actor ∪ from ∪ to | amount, currency, counterpart, **actor_is_payer** |
| `settlement_deleted` | 同上 | 同上(SQL 內算) | amount, currency, counterpart, **actor_is_payer**(刪除前從該列算) |
| `group_created` | 新群組 | 該群組現任成員 | — |
| `group_member_added` | 群組 | 該群組現任成員 | counterpart = 被加入的人 |
| `group_archived` | 群組 | 該群組現任成員 | — |

### 3.1 查詢寫在哪

`DrizzleSplitActivityRepository.listForUser`。可見範圍是一段
`CASE WHEN group_id IS NULL THEN viewer = ANY(audience_user_ids) ELSE EXISTS(該群組成員) END`,
在 `test/db/split-activity-visibility.test.ts` 對真 Postgres 驗,並逐條做突變驗證。

### 5.2 分頁:keyset,不是 offset

游標是 `<iso timestamp>|<uuid>`,查詢用 `(created_at, id) < (cursor)` 的列比較。
理由:這條時間軸只在頭部成長,offset 分頁下每多一筆新活動就把所有列往下推一格,
讀者會重複看到一筆、漏掉另一筆。id 進游標是因為**同一個 batch 寫入的活動共用時間戳**。

## Follow-ups(這次不做)

- **描述與參與者變更的差異**(4.3):`expense_updated` 目前只存改前/改後金額。
- **`audience_user_ids` 的 GIN 索引**:目前只有 `group_id` 與 `created_at` 的 btree。
  無群組活動變多之後,`= ANY(...)` 會是全表掃描。
- **前端**:分帳分頁裡的「動態」分頁是下一個 change。
