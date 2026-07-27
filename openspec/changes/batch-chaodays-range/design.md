# chaodays 匯入：長區間自動分批（issue #86 的後半）

## 問題

[issue #86](https://github.com/loftapartment/life-os/issues/86)：「匯入太長的時間區間，會被對方的 server 擋住」。

五個 import use case 都是同一個形狀：

```ts
const session = await chaodaysClient.signIn(input.uid, input.password);
const { records } = await chaodaysClient.fetchWeightRecords(session, input.from, input.to);
// …讀既有資料（整個區間一次）→ 逐日計算 → 一次寫入
```

`fetch*` 把使用者給的整段區間原封不動放進 chaodays 的 `start_date`/`end_date` query。區間一長就被擋，而且沒有降級 —— 整批失敗。

issue 的前半（選擇要匯哪些類型）已由前端 PR #92 完成。

## 設計決策

### D1 — 切在後端，不是前端

**因為登入次數**：每個 use case 一開頭都 `signIn()`。若在前端把區間切成 N 批、每批呼叫一次 use case，登入次數會變成 **批數 × 類型數** —— 匯三年（6 批）× 五類 = 30 次登入打同一台 chaodays。如果對方擋的是**請求速率**而不是單次區間長度，分批會讓情況更糟，正好與 issue 的目的相反。

後端切則維持**每類型登入一次**。

### D2 — 串接 `fetch*` 已經回傳的輪替 session

`ChaodaysClient` 的五個 `fetch*` **本來就回傳輪替後的 session** —— devise_token_auth 每次回應輪替 token，port 的註解明寫 `Returns the rotated session (devise token rotates each response) alongside the records`。現行 use case 只是 `const { records } = ...` 把它丟掉，因為單次呼叫用不到。

分批時把它接住、餵給下一批即可。這也是為什麼不需要新的 API、不需要傳遞憑證：**session 重用是這個 port 本來就支援的能力，只是沒人用過。**

### D3 — 只有「取資料」那一步變成迴圈，其餘一行不動

每個 use case 改動的範圍嚴格限縮成一行：

```ts
const session = await chaodaysClient.signIn(...);          // 不變，仍是一次
const records = await fetchInBatches(session, from, to, …); // 原本的單次 fetch
// ↓ 以下完全不變
const existing = await repository.listRange(userId, input.from, input.to);
// …逐日計算、一次寫入
```

後面的讀取／計算／寫入本來就對**整個** `[from, to]` 操作（`listRange(userId, input.from, input.to)`、一次 `db.batch` 寫入），累積完的 records 餵進去，結果與單次抓取**完全等價**。這是這個改法成立的關鍵：分批只發生在「向 chaodays 要資料」這一層，不觸碰任何 lifeos 這側的邏輯。

### D4 — 批次大小 183 天，固定天數而非月曆 6 個月

使用者指定「半年」。用**固定 183 天**而不是月曆上的 6 個月：月曆加法有月底空洞（8/31 + 6 個月沒有 2/31，會跳成 3/2 或 3/3），切點會隨起始日漂移、也難測。固定天數的切點完全可預測。

183 是使用者依實際經驗指定的值，**不是量測出來的上限**。若之後仍被擋，改這個具名常數即可 —— 它只有一處。

### D5 — 切分是純函式，放 domain

`[from, to]` → 連續、不重疊、不遺漏的子區間清單。純字串日期運算，不碰 client、不碰 repository，單元測試直接覆蓋所有邊界（單日、剛好 183、184、跨閏日、跨年、多年）。

**用 UTC 錨定**：這個 repo 已經踩過本地 `Date` 跨 DST 少算一天的虧（`day_format.dart` 的 `daysBetween` 有明確註解）。日期字串是 `YYYY-MM-DD`，一律 `Date.UTC` 建構、`toISOString().slice(0, 10)` 輸出。

### D6 — 失敗語意不變：某批失敗就整個拋

某一批 `fetch*` 失敗時，例外照舊往上拋（`ChaodaysAuthError` → 400、`ChaodaysUpstreamError` → 502），**不重試、不跳過、不部分寫入**。

因為寫入發生在**所有批次抓完之後**（D3），一次失敗代表這個類型這次完全沒寫進去 —— 沒有「寫了一半」的狀態要清理，重跑就是乾淨的重跑。這比逐批寫入單純得多，也維持了現行的錯誤合約。

### D7 — subrequest 預算

Cloudflare Workers 對每次 invocation 的 subrequest 有上限（這個 repo 踩過：diet 匯入曾因 O(days×meals×items) 個 SQL statement 爆掉，已改成 `db.batch`）。

分批只增加**向 chaodays 的 fetch 次數**（每批 1 個），DB 讀寫完全不變。以每類型一次呼叫計：`1 signIn + N fetch + 2~3 db.batch`。匯三年 N=6 → 約 10 個 subrequest，離上限很遠。粗估要到 40 批（約 20 年）才需要重新考慮。

## 元件

| 檔案 | 改動 |
| --- | --- |
| `src/contexts/health/domain/date-range-batches.ts`（新） | 純函式：切區間 + `CHAODAYS_BATCH_DAYS = 183` |
| `src/contexts/health/application/fetch-in-batches.ts`（新） | 泛型 helper：跑批次迴圈、串接 session、累積結果 |
| `import-chaodays-{weight,diet,water,bowel,diet-target}.ts` | 各一行：單次 `fetch*` → `fetchInBatches(...)` |

`ChaodaysClient` port、五個 repository、HTTP route、前端**全部不動**。

## 測試策略

- **切分（單元）**：`from == to` → 一批；剛好 183 天 → 一批；184 天 → 兩批且第二批從第一批的隔天開始；多年 → 每批 ≤183 天且串起來等於原區間（無縫無疊）；跨閏日；跨年；UTC 錨定（在非 UTC 時區跑不會少一天）。
- **helper（單元）**：單批時只呼叫一次 fetch；多批時依序呼叫且**每次都用前一次回傳的 session**（這是 D2 的回歸點 —— 用錯 session 在真實環境會 401，但用假 client 很容易寫成永遠傳初始 session 也照樣綠）；結果照批次順序串接；某批拋錯就直接往上拋、不吞。
- **五個 use case（單元，既有測試）**：`signIn` **仍然只被呼叫一次**（D1 的回歸點）；長區間會對 client 發出多次 fetch，參數是連續不重疊的子區間；最終寫入的資料與單次抓取等價（既有斷言不得退化）。
- **既有測試不得退化**：664 passed 是基準；五個 importer 的既有行為測試（idempotency、meal type、時區、all-zero guard 等）全部維持。

## 不做（YAGNI）

- 批次失敗重試／跳過續跑 —— 分批本身就是為了不被擋，先觀察實際效果。
- 批次大小可設定 —— 使用者指定半年就是半年。
- 平行抓取批次 —— 序列才能串接輪替的 session，而且平行等於把「請求太密集」的風險加回來。
- 逐批寫入 —— 見 D6，會引入「寫了一半」的狀態。
- 前端顯示批次進度 —— 後端一次呼叫回一個 summary，前端不知道也不需要知道分了幾批。
