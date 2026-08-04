## Why

這個 repo 的每個 `Drizzle*Repository` 測試都用手寫的假 `Db`,而它的 `where()` **直接把參數丟掉**;兩個 Vitest project 都沒有 Postgres 路徑。**所有 SQL 都是綠著上線、從沒被執行過。**

財務六個 sub-project 做完後,這個缺口暴露的東西已經不只是一句附註:分帳的**可見性 WHERE**(錯了整批洩漏別人的支出)、**雙人與群組的餘額聚合**(錢的數字)、**還款的符號方向**(設計文件為它寫了三輪、review 抓過兩次 blocking,而群組零和在兩種符號下都成立、測不出方向)、`shareAnyGroup`、`splitSpendingForUser`。前兩次裁定「接受缺口」都是為了不擋當下那條 change;現在沒有 change 要擋。

**可行性已經先驗過**(探針已刪除):`@electric-sql/pglite` + drizzle 0.45.2 自帶的 pglite driver/migrator,把現有 25 份 migration 全套上約 1 秒;真的 `DrizzleBalanceRepository` 直接跑得動,450 欠、還 300 → 150 正確;**把還款的兩個符號對調,探針立刻抓到 750**——就是那個一直沒有 CI 證據的「還完錢反而欠更多」。

## What Changes

- 新增 devDependency `@electric-sql/pglite`,以及第三個 Vitest project `db`(跑 `test/db/**`)。
- 一支共用 harness:開 PGlite、套 `./drizzle` 的 migration、回傳可餵給 repository 的 `Db`,並提供測試間清乾淨的方法。**`as unknown as Db` 只在 harness 這一個地方轉**。
- 覆蓋風險最高的讀取 SQL:`DrizzleBalanceRepository`(雙人 + 群組,含還款方向)、`DrizzleSplitExpenseRepository.listForUser` 的可見性、`splitSpendingForUser`、`shareAnyGroup`。
- **每一條新測試都要做突變測試**——把對應的 SQL 改錯、確認會紅。這一期的全部價值在此:若 SQL 改錯還是綠,新測試就跟現在的假 `Db` 沒有差別。

**不改任何 production 程式碼**。這是補證據,不是改行為;測試若抓到 bug,單獨處理並在報告裡說明。

範圍外:回頭重寫其他 context 既有的假 `Db` 測試;用 `db.batch` 的寫入路徑(見下)。

## 已知限制(要寫進 harness 註解,不能讓下一個人誤會)

- **pglite driver 沒有 `batch`**,所以分帳支出的建立/更新那條原子寫入路徑**無法**照原樣執行。測試改成直接插列準備資料、驗讀取端。這一期證明的是「查詢寫對了」,**不是**「一批寫入是原子的」。
- **PGlite 不是 Neon**:同為 Postgres 但非同一部署,連線層行為(neon-http 無交易、逾時、連線池)不在覆蓋範圍。它證明的是 **SQL 語意**,那正是目前完全沒有證據的那一半。

## Capabilities

### Modified Capabilities

- `ci-cd`:測試套件新增一個對真 Postgres 執行 SQL 的 project。

## Impact

- 新增 `test/db/**`、`vitest.db.config.ts`(或等價設定),修改 `vitest.config.ts`、`package.json`。
- **零 production 程式碼變更**。
- CI 不需改設定:PGlite 是 WASM,不需要 Docker 或外部服務。
