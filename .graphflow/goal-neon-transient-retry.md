# 目標

Neon 的 HTTP endpoint 偶發回 520,而目前**完全沒有重試**,所以一次短暫失敗就直接變成使用者眼前的 500。加上安全的重試。

專案:life-os-backend —— Cloudflare Workers(Free 方案)+ Hono + drizzle-orm(neon-http)+ Neon Postgres,TypeScript。

## 事故現場(已查證,不要重新假設)

2026-08-14 使用者回報「又很多 500」。`wrangler tail` 抓到的實際錯誤鏈(PR #96 加的 `describeErrorChain` 讓它可讀):

```
["internal error",{"layers":[
  {"name":"Error","message":"Failed query: select \"id\", \"firebase_uid\", ... from \"users\" where \"users\".\"firebase_uid\" = $1 limit $2\n[redacted-params]"},
  {"name":"NeonDbError","message":"Server error (HTTP status 520): error code: 520\n"}
]}]
```

同一批六個請求(12:09:45–46,前端首頁的並行載入):

```
12:09:45 200 /api/finance/transactions
12:09:45 200 /api/finance/split-spending
12:09:45 200 /api/finance/categories
12:09:45 500 /api/finance/budgets
12:09:45 500 /api/finance/summary
12:09:46 500 /api/me
```

**三成功三失敗,同一瞬間。**

## 已經排除的成因(逐一量過,不要再花時間重驗)

- **不是 Neon 掛掉或額度用完**:本機直連 `select 1` 循序 8/8 成功(62ms 穩態)
- **不是併發過高**:本機一次發 6 / 12 / 24 個並行查詢,全部成功
- **不是冷啟動**:Neon console 的 System operations 顯示 compute 於 11:55 啟動後**到 12:09 之間沒有任何 Suspend/Start**,那批 520 發生時 compute 是醒的
- **不是持續性的**:事後再開 `wrangler tail` 抓到 31 個事件全部 200/204,零 500。這是一個**已經過去的時段**

順帶量到的參考值:當地冷啟動(靜置 7 分鐘後的第一個查詢)客戶端耗時 **303 ms**,後續 210/62/73 ms;Neon 控制平面記錄的 Start compute 操作耗時 311 ms – 1 s。

## 真正的問題

**根因不明,而且可能無法從我們這側查明**(520 是 Cloudflare 對「來源回了無效回應」的代碼,Neon 的 HTTP endpoint 也在 Cloudflare 後面)。

但有一件事無論根因為何都成立、而且是我們自己的缺陷:

`src/shared/db/client.ts` 只是 `neon(databaseUrl)` + `drizzle(sql)`。**沒有任何重試**。`@neondatabase/serverless` 1.1.0 也沒有內建重試選項(已確認 `HTTPQueryOptions` 只有 `arrayMode` / `fullResults` / `fetchEndpoint` / `fetchConnectionCache` / `fetchFunction`)。

所以一次暫時性的 520 = 一個使用者看到的 500。

## 要做的

用 `neon()` 的 `fetchFunction` 選項包一層重試。這是**唯一一個能同時涵蓋所有查詢**(HTTP 路由、cron、workflow instance)的位置。

### 不可妥協的安全限制:只重試唯讀查詢

**520 代表「沒收到有效回應」,不代表「查詢沒有執行」。** 盲目重試一個 `INSERT` 可能寫兩筆;重試 `UPDATE ... SET x = x + 1` 會加兩次。

`neon-http` 的每個查詢是一次獨立的 HTTP POST,body 是 `{query, params}` 的 JSON,**所以 `fetchFunction` 看得到 SQL 文字**,可以據此判斷。

判斷規則由你設計,但必須是**保守的白名單**(看起來像唯讀才重試),不是黑名單(不像寫入就重試)。特別注意這些會讓天真的判斷出錯的形態,請自己找出全部並處理:

- `WITH ... AS (INSERT ... RETURNING ...) SELECT ...` —— 開頭是 `WITH`/`SELECT` 但其實會寫
- `SELECT ... FOR UPDATE`
- 呼叫有副作用的函式的 `SELECT`
- 前導空白、註解(`-- ...`、`/* ... */`)、大小寫混雜
- 這個 repo 實際用到的形態:`INSERT ... ON CONFLICT ... RETURNING`(見 `drizzle-care-day-instance-pointer-store.ts` 的 CAS)、`update ... set ... where ...`(`decrementStock`)

**寫入路徑不重試是刻意的,不是遺漏** —— 要在註解裡寫清楚為什麼,以及使用者在寫入遇到 520 時會看到什麼(仍然是 500,但那是正確的行為:我們寧可讓他重試一次,也不要重複扣庫存/重複記帳)。

### 其他要求

- **重試次數與間隔**:自己決定並說明理由。注意 Workers Free 方案**每次呼叫 10ms CPU**(等待 IO 不算 CPU,但要確認你的實作沒有引入 busy-wait),以及 HTTP 請求本身有整體時間預算
- **哪些錯誤該重試**:520 只是我們觀察到的那一個。請自己判斷還有哪些(其他 5xx?網路層失敗?)該納入,以及**哪些絕對不該重試**(4xx、SQL 語法錯誤、唯一鍵衝突 —— 重試只會再錯一次還拖慢回應)
- **重試發生時必須記錄**(`console.warn` 或既有的 logging),否則我們會失去「這件事發生得多頻繁」的能見度,而那正是日後判斷根因需要的資料。**沉默的重試會把一個可觀測的問題變成不可觀測的問題。**
- 不要改 `drizzle` 的用法、不要動任何 repository、不要改任何 SQL

## 驗證

- `npm run typecheck` 綠
- `npx vitest run --no-file-parallelism` 全綠 —— **基準 126 檔 / 1492 條**,要回報明確的檔數與條數
- 守門要能被突變殺死,而且**兩個方向都要**:
  - 拿掉重試 → 「暫時性失敗後第二次成功」的測試必須紅
  - 把重試放寬到所有查詢(含寫入)→ 「寫入類查詢不得重試」的測試必須紅
- **唯讀判斷本身要有充分的測試**:上面列的每一種形態(含 `WITH ... INSERT`、`FOR UPDATE`、註解與空白前綴)都要有 case,而且**突變判斷式**(例如把 `WITH` 的檢查拿掉)要能讓對應 case 紅
- 用假的 fetch 注入失敗,不要打真的 Neon

## 專案規範

- 遵守 repo 根的 CLAUDE.md 與 life-os-backend/CLAUDE.md(Clean Architecture + DDD、domain/application 不可 import adapters 或 shared/db)
- 這個 repo 反覆長出「不可能失敗的守門」與「註解比事實強」。每寫一條守門就對它突變確認拿掉修法會紅;每寫一句註解、每一個數字都要能被程式碼支持(**近期就寫過一個沒數過的 `~5 steps`,實際是 8**)
- **不要宣稱這個修法解決了根因** —— 它沒有。它把一個暫時性故障從「使用者看到 500」降級成「慢一點但成功」,根因仍然未知。文件與註解要誠實反映這一點
