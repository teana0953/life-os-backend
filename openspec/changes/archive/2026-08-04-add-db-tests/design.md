# DB 級測試(PGlite)— 設計

## 為什麼現在做

這個 repo 的每個 `Drizzle*Repository` 測試都用手寫的假 `Db`,而它的 `where()` **直接把參數丟掉**;兩個 Vitest project 都沒有 Postgres 路徑。所以每一段 SQL 都是綠著上線、沒被執行過。

財務六個 sub-project 做完之後,這個缺口的暴露面已經不是一句附註:

- **分帳的可見性 WHERE** —— 錯了就是整批洩漏別人的支出。
- **雙人與群組的餘額聚合** —— 錢的數字。
- **還款的符號方向** —— 設計文件為了它寫了三輪、review 抓過兩次 blocking,而群組零和不變量在兩種符號下都成立,測不出方向。
- `shareAnyGroup`、`splitSpendingForUser`、`listForUser` 的參與條件。

先前兩次裁定「接受缺口」都是為了不擋當下那條 change;現在沒有 change 要擋。

## 可行性已經先驗過,不是紙上談兵

動手前先跑過探針(已刪除):

- `@electric-sql/pglite` + `drizzle-orm/pglite` 的 driver 與 migrator 都在 drizzle 0.45.2 裡,不用升級。
- `migrate(db, { migrationsFolder: "./drizzle" })` 把現有 25 份 migration 全部套上,整段約 1 秒。
- **真的 `DrizzleBalanceRepository` 直接跑得動**:插入使用者、支出、share、還款之後,`balancesForUser` 回 450 → 還 300 → 150,正確。
- **把還款的兩個符號對調,探針立刻抓到 750**——就是「還完錢反而欠更多」那個一直沒有 CI 證據的 bug。

## 範圍

**這一期只做基礎建設 + 覆蓋風險最高的那幾段讀取 SQL**,不回頭重寫其他 context 既有的假 `Db` 測試。

做:
- 第三個 Vitest project `db`,跑 `test/db/**`。
- 一支共用的 harness:開 PGlite、套 migration、回傳一個能餵給 repository 的 `Db`,以及每個測試之間清乾淨的方法。
- 覆蓋:`DrizzleBalanceRepository`(雙人 + 群組,含還款方向)、`DrizzleSplitExpenseRepository.listForUser` 的可見性、`splitSpendingForUser`、`DrizzleExpenseGroupRepository.shareAnyGroup`。

不做:
- **不改任何 production 程式碼**。這一期是補證據,不是改行為;如果測試抓到 bug,那是另一件事,要單獨處理並在報告裡講清楚。
- 不回頭改寫既有的假 `Db` 測試(它們仍有價值:驗的是 repository 的分支邏輯,只是驗不到 SQL)。
- 不覆蓋用 `db.batch` 的寫入路徑,見下。

## 已知限制,要誠實寫進 harness 的註解

**`drizzle-orm/pglite` 的 driver 沒有 `batch`。** 分帳支出的建立與更新靠 `db.batch` 取得原子性,所以那條路**沒辦法**在 PGlite 上照原樣執行。測試改成直接插入列來準備資料,然後驗讀取端。

也就是說這一期**不會**證明「一批寫入是原子的」——它證明的是「查詢寫對了」。這兩件事不能混為一談,harness 的註解要寫明,否則下一個人會以為 batch 也被蓋到了。

**PGlite 不是 Neon。** 同樣是 Postgres,但不是同一個部署;連線層的行為(neon-http 的無交易限制、逾時、連線池)不在覆蓋範圍內。它證明的是 **SQL 語意**,那正是目前完全沒有證據的那一半。

## 型別怎麼接

repository 收的是 `Db = ReturnType<typeof createDbClient>`(neon-http 的 drizzle 實例)。PGlite 的 drizzle 實例型別不同但查詢建構 API 相同,所以 harness 用一次 `as unknown as Db` 把它轉過去,**而且只在 harness 這一個地方轉**——不要散在每個測試裡。這個轉型要有註解說明它換掉的是什麼、以及 `batch` 是唯一實際缺的東西。

## 測試要驗什麼(不是「跑得動」而已)

每一條都要是**「寫錯就會紅」**的斷言,不是煙霧測試:

- **可見性**:非參與者的查詢結果不包含該筆支出;群組成員(不持 share)看得到;`with=` 只回無群組的。每條都要有反向案例。
- **餘額方向**:被欠、欠人、部分還款、多還翻向另一邊,各自斷言**有號數值**;群組的零和只當附加檢查,不當方向檢查。
- **付款人自己那份**:餘額排除、自付額計入——這兩條規則方向相反,各驗一次。
- **多幣別**:永不相加,結清後該幣別消失。
- **`shareAnyGroup`**:有共同群組 / 沒有,各一。

**每一條都要做突變測試**:把對應的 SQL 改錯,確認測試會紅。這一期的全部價值就在這裡——如果新測試在 SQL 改錯時仍然綠,那它跟現在的假 `Db` 沒有差別。

## CI

`db` project 併進 `npm test`。PGlite 是 WASM、不需要 Docker 也不需要外部服務,CI 不用改設定。若整體時間明顯變長,再評估是否只在特定路徑跑——但先量了再說,探針顯示單檔約 1 秒。
