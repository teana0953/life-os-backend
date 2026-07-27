## Why

[issue #86](https://github.com/loftapartment/life-os/issues/86)：「匯入太長的時間區間，會被對方的 server 擋住」。issue 的前半（選擇要匯哪些類型）已由前端 PR #92 完成，這個 change 做後半。

五個 import use case 都是同一個形狀：`signIn()` 之後一次 `fetch*(session, from, to)`，把使用者給的整段區間原封不動放進 chaodays 的 `start_date`/`end_date` query。區間一長就被擋，而且沒有降級 —— 整批失敗。

## What Changes

- **新增 `src/contexts/health/domain/date-range-batches.ts`**：純函式，把 `[from, to]` 切成每批最多 **183 天**的連續、不重疊、不遺漏的子區間，並匯出批次大小常數。用固定天數而非月曆 6 個月（8/31 + 6 個月沒有 2/31，切點會隨起始日漂移）；以 `Date.UTC` 錨定（這個 repo 踩過本地 `Date` 跨 DST 少算一天的虧）。
- **新增 `src/contexts/health/application/fetch-in-batches.ts`**：泛型 helper，跑批次迴圈、**串接 `fetch*` 回傳的輪替 session**、依序累積結果。
- **五個 use case 各改一行**：單次 `fetch*` → `fetchInBatches(...)`。`signIn()` 仍然只呼叫一次。

**切在後端而不是前端，是因為登入次數**：每個 use case 一開頭都 `signIn()`，在前端分批會讓登入次數變成「批數 × 類型數」（匯三年 = 30 次登入打同一台 chaodays），若對方擋的是速率就適得其反。後端切維持每類型登入一次。

這個改法成立的關鍵是 `ChaodaysClient` 的五個 `fetch*` **本來就回傳輪替後的 session**（devise_token_auth 每次回應輪替 token，port 註解明寫），現行 use case 只是 `const { records } = ...` 把它丟掉。**session 重用是這個 port 本來就支援的能力，只是沒人用過** —— 不需要新 API、不需要改憑證傳遞。

改動嚴格限縮在「向 chaodays 要資料」這一層：後面的讀既有資料（`listRange(userId, input.from, input.to)`）、逐日計算、一次 `db.batch` 寫入全部不動，因為它們本來就對**整個**區間操作。累積完的 records 餵進去，結果與單次抓取完全等價。

`ChaodaysClient` port、五個 repository、HTTP route、前端**全部不動**。Gate = `npm test` + `npm run typecheck`。

## Capabilities

### Modified Capabilities

- `chaodays-import`: 匯入 SHALL 把過長的日期區間切成多次上游請求，而不是讓整批失敗；每個類型 SHALL 仍然只登入一次。
