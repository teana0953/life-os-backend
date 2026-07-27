# Tasks

## 1. 切分純函式 (TDD)
- [ ] Test first (red)：`test/contexts/health/domain/date-range-batches.test.ts`
  - `from === to` → 一批，就是那一天
  - 剛好等於批次大小 → 一批
  - 大一天 → 兩批，第二批從第一批結束的**隔天**開始，無縫無疊
  - 多年區間 → 每批 ≤ 批次大小，串接起來逐字等於原區間（無 gap、無 overlap、無遺漏）
  - 跨閏日（例如涵蓋 2028-02-29）、跨年
  - **UTC 錨定**：在 `TZ=America/New_York` 之類的非 UTC 時區下跑，結果與 UTC 下相同（本地 `Date` 跨 DST 會少算一天 —— 這個 repo 踩過）
- [ ] `src/contexts/health/domain/date-range-batches.ts`：匯出 `CHAODAYS_BATCH_DAYS = 183` 與切分函式。輸入輸出都是 `YYYY-MM-DD` 字串；內部一律 `Date.UTC` 建構、`toISOString().slice(0, 10)` 輸出。

## 2. 批次 helper (TDD)
- [ ] Test first (red)：`test/contexts/health/application/fetch-in-batches.test.ts`，用假的 fetch 函式
  - 單批：只呼叫一次，參數就是原區間
  - 多批：依序呼叫，區間是切分函式給的子區間
  - **每次都用前一次回傳的 session**（D2 的回歸點）——假 fetch 要每次回**不同**的 session 物件並記錄收到的那個；若實作寫成永遠傳初始 session，這條必須紅。**注意**：假 fetch 若每次回同一個 session，這條測試會永遠綠、等於沒測
  - 結果依批次順序串接
  - 某批拋錯 → 直接往上拋，不吞、不續跑後面的批次
- [ ] `src/contexts/health/application/fetch-in-batches.ts`：泛型 helper，簽名容納「回 `{ session, records }`」與「回 `{ session, menus }`」兩種形狀（呼叫端 adapt 成同一個提取形式即可，不要為此改 `ChaodaysClient` port）。

## 3. 五個 use case 各接上 (TDD)

> **⚠️ 假 client 陷阱（會做出資料錯誤，不只是測試失效）**：既有測試的假 client
> `fetch*` **完全不看 from/to**，一律 `return this.records`。直接拿它寫長區間測試的話，
> 每一批都回同一組資料 —— water 的當日總和會變成 ×N、bowel 的 count 也會 ×N，而測試
> 可能還是綠的（因為斷言是照著錯誤結果寫的）。長區間測試必須用**會依 from/to 過濾**的
> 假 client。

- [ ] Test first (red)，對每個 importer 各一條：長區間（>183 天）會對 client 發出**多次** fetch，參數是連續不重疊的子區間，且 **`signIn` 只被呼叫一次**。
- [ ] Test first (red)，**等價性**（spec 的 `The result does not depend on how the range was split`，目前沒有任何斷言守它）：同一組資料、同一個區間，一次抓完 vs 切成多批，**寫進 repository 的內容與回傳的 summary 逐欄相同**。至少對 water（當日加總）與 diet（同型合併／snack 編號）各做一條 —— 那是最容易因為分批而算錯的兩個。
- [ ] `import-chaodays-{weight,diet,water,bowel,diet-target}.ts`：單次 `fetch*` → `fetchInBatches(...)`。**只動這一行**，後面的讀取／逐日計算／寫入一律不碰。
- [ ] 確認五個 importer 的既有測試全部維持通過 —— 它們斷言的是「給定這些 records，寫出什麼」，而分批不改變餵進去的 records，所以不該有任何一條需要改。**若有測試變紅，代表行為真的變了，回頭查而不是改斷言。**

## 4. Gate
- [ ] `npm test` + `npm run typecheck` 全綠。基準是 **664 passed**，五個 importer 的既有行為測試（idempotency、meal type、時區、all-zero guard、glucose 去重等）零退化。

## 5. On-device verification (manual — 需使用者，部署後)
- [ ] 用一段**超過 183 天**的區間跑一次真實匯入，確認完成而不是被擋。
- [ ] 確認匯入結果正確（不是只有第一批的資料），特別**對一下交界日**（第 183／184 天）的數字 —— 那是唯一可能破壞等價性的生產風險。
- [ ] **若失敗，先分辨是哪一種**：session 串接失敗（第二批 401 → 502）的外觀與「被 chaodays 擋住」**完全相同**。`sessionFromHeaders` 在 header 缺席時會靜默沿用舊 session，所以若上游沒在資料請求的回應帶回 session header，第二批就會失敗。看 Worker log 裡失敗發生在第幾批：第一批就失敗 = 真的被擋；第一批成功、第二批 401 = session 串接問題。
- [ ] 順帶留意**耗時**：分批把 1 次上游請求變成最多 N 次序列請求，新的天花板是前端 timeout 與 Cloudflare 的 edge 時間限制，不再是 subrequest 數量。
