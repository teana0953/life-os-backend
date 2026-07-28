# Tasks

## 1. Client: `fetchMenstruals` 含分頁 (TDD)

- [x] Test first (red)：比照既有五個 fetch 的測試位置
  - 第一頁有資料 → 發第二次且 `page=2`；第二頁回 **0 筆 → 停**。結果**依序串接**。URL 帶 `start_date`/`end_date`/`page`/`per_page=20`
  - **第一頁回 3 筆（不足 20）、第二頁還有資料 → 那些也要匯入**（釘住「不足 requested 不等於最後一頁」，見 design D1）
  - 一直回滿 20 筆 → 打到**每批 20 頁**上限後丟 `ChaodaysUpstreamError("pagination")`
  - **第二頁用第一頁回傳的輪替 session**（假 fetch 每次要回**不同**的 session header，否則這條恆綠 —— 與 PR #54 的 `fetch-in-batches` 同款陷阱）
  - **假 fetch 回的信封不要放 `pagination`** —— 停止條件不該讀它；回了就掩蓋掉「實作偷讀信封鍵名」這個 bug
  - `ended_date` 是空字串 → 映射成 `null`；`ended_date < started_date` → `ChaodaysUpstreamError("parse")`；`started_date` 缺失或空字串 → `"parse"`（沒有這道檢查，畸形資料會在 `addPeriod` 丟出沒被 onError 映射的 `InvalidPeriodError` → 500）
  - **請求走 `this.request`**：注入 relay 設定，斷言請求打到 relay base URL 且帶 `X-Relay-Secret`（既有 relay 測試只涵蓋 `signIn` 與 `fetchWeightRecords`，不補這條就守不到）
  - 非 200 → `ChaodaysUpstreamError(status_*)`；JSON 壞掉／`data` 不是陣列 → `"parse"`（比照既有五個）
- [x] `domain/chaodays-client.ts`：加 `ChaodaysMenstrualRecord { id, startDate, endDate: string | null }`（`id` 只用於跨批次去重，不落地）與 `fetchMenstruals(session, from, to): Promise<{ session, records }>`。**port 形狀與其他五個一致** —— 分頁是實作細節，不外洩到 use case。
- [x] `adapters/http-chaodays-client.ts`：實作分頁迴圈。**走 `this.request`**（不是 `fetchImpl`），否則漏掉 relay base URL 與 `X-Relay-Secret`。明確帶 `per_page=20`（見 design D1，不要改大）。`started_date`/`ended_date` → 對應欄位；`days`/`content` 丟掉。

## 2. 重疊判斷（純函式，先做）

- [x] Test first (red)：閉區間重疊判斷，含開放結尾
  - 完全相同 → 重疊；部分重疊 → 重疊；包含 → 重疊
  - **相鄰不重疊**（5/1–5/5 vs 5/6–5/10）→ 不重疊
  - **對稱**：`overlaps(a,b) === overlaps(b,a)`，兩個方向的部分重疊各測一次
  - 其中一段 `endDate == null` → 視為延伸到無限遠；**含「另一段起始日早於它但仍重疊」**（開放 5/10–，另一段 5/09–5/14 → 重疊）
- [x] 實作成可單獨測試的純函式 —— 它是這個 change 唯一有邏輯的部分。

## 3. Use case: `importChaodaysMenstrual` (TDD)

- [x] Test first (red)：`test/contexts/health/application/import-chaodays-menstrual.test.ts`
  - 沒有既有資料 → 全寫；summary 形狀比照既有（imported / skipped）
  - 與 lifeos 既有期間重疊 → 跳過（含起始日差一天）；相鄰不重疊 → 寫入
  - lifeos 有開放期間 → 之後的來源期間都跳過
  - **來源是開放期間（`endDate == null`）→ 不匯入**（design D2a）
  - **同一次匯入內兩筆彼此重疊 → 只寫一筆**（已接受的要累積進比較集合）
  - **來源期間早於既有開放期間但重疊 → 跳過**（單向規則會漏掉這個，見 design D2）
  - **summary 的批次無關性**：同一區間，一次抓完 vs 拆成多批（讓一筆生理期落在批次交界、被上游回兩次）→ **寫入筆數與 imported/skipped 都相同**。兩個 arm 要固定同一個區間、**只換假 client 的重複行為**，否則變成在比較兩組不同輸入。這條才是 `id` 去重的守門測試；只測「同一個 id 只寫一筆」的話，沒有 id 去重也會綠（重複那筆必然與已接受的重疊而被跳過）
  - 重跑同一個匯入 → 第二次不新增
  - 長區間（>183 天）→ 對 client 發多次 fetch，且 **`signIn` 只有一次**（比照既有五個 importer 的回歸點）
  - **失敗不寫入**：第一批回**至少一筆會被寫入**的期間、第二批丟錯 → 整個拋且**寫入 call count 為 0**。配一條資料相同但不失敗的測試斷言 `imported === 1`，兩條互相釘住（否則「第一批其實沒東西可寫」也會讓失敗版假綠）
- [x] `application/import-chaodays-menstrual.ts`：`signIn` 一次 → `fetchInBatches` 抓完 → `listByUser` 讀既有 → 依序濾掉重疊／重複 → 逐筆 `addPeriod`。**讀取在所有抓取之後、寫入之前**；寫入走 `addPeriod` 而非 `repository.add`（design D4）。

## 4. Route + 組裝

- [x] `adapters/http/routes/import-chaodays.ts`：加 `POST /api/import/chaodays/menstrual`，body 與錯誤映射比照既有五個（`chaodays_uid`/`chaodays_password`/`start_date`/`end_date`；auth → 400、upstream → 502、`from > to` → 400）。
- [x] `adapters/http/app.ts`：把 `menstrualRepository` 加進 import 路由的 options（`src/index.ts` 不用改 —— 它已經建好並傳給 `createApp` 了）。
- [x] Route 測試比照既有五個（含 `from > to` 的 400）。

## 5. Gate

- [x] `npm test` + `npm run typecheck` 全綠。基準 **689 passed**，既有五個 importer 零退化。

## 6. On-device verification (manual — 需使用者，部署後)

- [ ] 匯一段有生理期紀錄的區間，確認筆數與起訖日正確。
- [ ] **再匯一次同一段**，確認沒有新增重複（重疊跳過生效）。
- [ ] 若 lifeos 已有手動記的期間，確認它沒有被改動。
- [ ] 若當下 chaodays 有一次「還沒結束」的生理期，確認它**沒有**被匯入（等結束後再匯才會進來）。
