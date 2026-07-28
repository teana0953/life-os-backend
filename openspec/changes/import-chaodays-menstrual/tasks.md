# Tasks

## 1. Client: `fetchMenstruals` 含分頁 (TDD)
- [ ] Test first (red)：`test/contexts/health/adapters/http-chaodays-client.test.ts`（或新檔，比照既有位置）
  - 一頁就取完 → 只發一個請求，URL 帶 `start_date`/`end_date`/`page=1`/`per_page`
  - 兩頁 → 發兩次、第二次 `page=2`，結果**依序串接**
  - **第二頁用第一頁回傳的輪替 session**（假 fetch 每次要回**不同**的 session header，否則這條恆綠 —— 與 PR #54 的 `fetch-in-batches` 同款陷阱）
  - 上游說還有下一頁但 `data` 是空陣列 → **停**（防無窮迴圈）
  - 非 200 → `ChaodaysUpstreamError(status_*)`；JSON 壞掉／`data` 不是陣列 → `ChaodaysUpstreamError("parse")`（比照既有五個）
- [ ] `domain/chaodays-client.ts`：加 `ChaodaysMenstrualRecord { date 相關欄位 }` 與 `fetchMenstruals(session, from, to): Promise<{ session, records }>`。**port 形狀與其他五個一致** —— 分頁是實作細節，不外洩到 use case。
- [ ] `adapters/http-chaodays-client.ts`：實作分頁迴圈。**明確帶 `per_page`**，不要靠上游預設（上游改了我們才發現就太晚）。`started_date`/`ended_date` → 對應欄位；`days`/`content` 丟掉。

## 2. Use case: `importChaodaysMenstrual` (TDD)
- [ ] Test first (red)：`test/contexts/health/application/import-chaodays-menstrual.test.ts`
  - **重疊判斷**：起訖完全相同 → 跳過；起始日差一天但區間重疊 → 跳過；**相鄰但不重疊**（既有 5/1–5/5、來源 5/6–5/10）→ 寫入；既有有開放結尾（`endDate == null`）→ 之後開始的都跳過；沒有既有資料 → 全寫
  - 重跑同一個匯入 → 第二次不新增
  - 長區間（>183 天）→ 對 client 發多次 fetch，且 **`signIn` 只有一次**（比照既有五個 importer 的回歸點）
  - **某批／某頁失敗 → 整個拋，且寫入方法 call count 為 0**（寫入在所有抓取之後；比照 PR #54 補的那五條）
  - summary 形狀比照既有（imported / skipped）
- [ ] `application/import-chaodays-menstrual.ts`：`signIn` 一次 → `fetchInBatches` 抓 → `listByUser` 讀既有 → 濾掉重疊 → 逐筆 `add`。**讀取在所有抓取之後、寫入之前。**
- [ ] 重疊判斷寫成**可單獨測試的純函式**（兩個區間是否重疊，含開放結尾）—— 它是這個 change 唯一有邏輯的部分。

## 3. Route + 組裝
- [ ] `adapters/http/routes/import-chaodays.ts`：加 `POST /api/import/chaodays/menstrual`，body 與錯誤映射比照既有五個（`chaodays_uid`/`chaodays_password`/`start_date`/`end_date`；auth → 400、upstream → 502、`from > to` → 400）。
- [ ] `src/index.ts`：把 `menstrualRepository` 注入 import 路由。
- [ ] Route 測試比照既有五個（含 `from > to` 的 400）。

## 4. Gate
- [ ] `npm test` + `npm run typecheck` 全綠。基準 **689 passed**，既有五個 importer 零退化。

## 5. On-device verification (manual — 需使用者，部署後)
- [ ] 匯一段有生理期紀錄的區間，確認筆數與起訖日正確。
- [ ] **再匯一次同一段**，確認沒有新增重複（重疊跳過生效）。
- [ ] 若 lifeos 已有手動記的期間，確認它沒有被改動。
