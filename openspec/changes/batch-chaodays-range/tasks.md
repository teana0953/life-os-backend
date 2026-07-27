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
- [ ] Test first (red)，對每個 importer 各一條：長區間（>183 天）會對 client 發出**多次** fetch，參數是連續不重疊的子區間，且 **`signIn` 只被呼叫一次**。
- [ ] `import-chaodays-{weight,diet,water,bowel,diet-target}.ts`：單次 `fetch*` → `fetchInBatches(...)`。**只動這一行**，後面的讀取／逐日計算／寫入一律不碰。
- [ ] 確認五個 importer 的既有測試全部維持通過 —— 它們斷言的是「給定這些 records，寫出什麼」，而分批不改變餵進去的 records，所以不該有任何一條需要改。**若有測試變紅，代表行為真的變了，回頭查而不是改斷言。**

## 4. Gate
- [ ] `npm test` + `npm run typecheck` 全綠。基準是 **664 passed**，五個 importer 的既有行為測試（idempotency、meal type、時區、all-zero guard、glucose 去重等）零退化。

## 5. On-device verification (manual — 需使用者，部署後)
- [ ] 用一段**超過 183 天**的區間跑一次真實匯入，確認完成而不是被擋。
- [ ] 順便確認匯入結果正確（不是只有第一批的資料）。
