# chaodays 匯入：生理期（issue #85 後端）

## 問題

[issue #85](https://github.com/loftapartment/life-os/issues/85)：「[匯入 chaodays] 增加生理期」。

chaodays 匯入目前支援五種：體重／飲食＋血糖／飲水／排便／飲食目標。生理期是第六種。

## 來源（研究結果，2026-07-28）

從 `https://chaodays.app/tw/user/period` 的前端 bundle（`/assets/main-*.js`）取得：

```
GET users/menstruals?start_date=&end_date=&page=1&per_page=20
→ data[]: { id, started_date, ended_date, days, content }
```

同一個 API 也有 `POST`／`PUT`／`DELETE users/menstruals` 與 `users/menstruals/dashboard`（`avg_days`／`avg_interval`／`chart_data`），本 change 只讀清單。

**對應到 lifeos**：`MenstrualPeriod { startDate, endDate: string | null }`。`started_date` → `startDate`、`ended_date` → `endDate`。`days` 可從起訖推算、`content`（備註）lifeos 沒有欄位，**兩者都丟掉** —— 比照既有匯入丟掉 chaodays 的 oil/sugar。

## 設計決策

### D1 — 這個端點有分頁，其他五種沒有

前端呼叫 weight／water／defecation／diet_records／diet_menus 時**只帶日期**；唯獨 menstruals 帶 `page` + `per_page`（預設 1 / 20），而且回應信封本來就有 `pagination`（Pagy）。現有的 `HttpChaodaysClient` 五個 `fetch*` **完全沒讀 `pagination`**、只取 `data` —— 照抄那個寫法會在資料超過一頁時靜默漏掉。

所以 `fetchMenstruals` 要在 **client 內部**跑分頁迴圈，直到取完才回傳。理由：

- port 的形狀與其他五個一致（`{ session, records }`），use case 不必知道上游分頁。
- session 每次回應都輪替，迴圈內串接、回傳最後一個 —— 與 `fetchInBatches`（PR #54 的日期分批）的串接方式相同，兩者疊加時仍然正確。

**實務上大概不會真的翻頁**：生理期資料稀疏，一個 183 天批次約 6 筆、遠低於一頁 20 筆。但正確性不能靠資料密度。**明確帶 `per_page`** 而不是靠預設值，讓「一頁多少」是我們決定的、不是上游改了我們才發現。

### D2 — 重疊就跳過，不覆蓋

匯入是冪等的：chaodays 的一段期間若與 lifeos 既有的任何一段**日期重疊**，就跳過不寫。

用「重疊」而非「起始日相同」：兩邊各自記錄同一次生理期時，起始日很容易差一天（lifeos 記 5/1、chaodays 記 5/2）。用起始日當鍵會建立兩段重疊的期間，把平均週期與預測算歪 —— 而那正是這個資料的用途。

與既有五種匯入的決策一致（已有資料就不覆蓋）。代價：lifeos 有一段「還沒結束」的期間、而 chaodays 那邊已有完整起訖時，**結束日不會被補上** —— 使用者確認過接受。

**開放結尾（`endDate == null`）的重疊判斷**：視為從 `startDate` 延伸到無限遠。所以任何晚於它的 chaodays 期間都會被視為重疊而跳過 —— 這是保守的正確方向（不確定時不寫）。

### D3 — 讀既有期間用 `listByUser`，一次讀完

`MenstrualRepository` 沒有 range 版本的查詢，只有 `listByUser(userId)`（全部、依 `startDate` 升冪）。生理期資料量小（一年約 12 筆），一次讀完可接受，也省得為這個 change 擴充 port。

讀取發生在**所有批次抓完之後、寫入之前**，與其他五個 importer 相同 —— 一次失敗代表完全沒寫，重跑是乾淨的重跑。

### D4 — 寫入用既有的 `add`，逐筆

`MenstrualRepository` 沒有 `addMany`。生理期筆數少（183 天約 6 筆、三年約 36 筆），逐筆 `add` 的 subrequest 數遠低於上限，不值得為它擴充 port 或做 batch。

這與其他五個 importer 的 `db.batch` 慣例不同，理由是資料量級差兩個數量級（飲食是 O(天×餐×品項)，生理期是 O(週期)）。

## 元件

| 檔案 | 改動 |
| --- | --- |
| `domain/chaodays-client.ts` | 加 `ChaodaysMenstrualRecord` 與 `fetchMenstruals` |
| `adapters/http-chaodays-client.ts` | 實作，含**分頁迴圈**與 session 串接 |
| `application/import-chaodays-menstrual.ts`（新） | use case：分批抓 → 讀既有 → 濾掉重疊 → 逐筆 add |
| `adapters/http/routes/import-chaodays.ts` | 新增 `POST /api/import/chaodays/menstrual` |
| `src/index.ts` | 注入 `menstrualRepository` 到 import 路由 |

前端（`ImportType.menstrual` + UI 列 + l10n）**是另一個 change**，在 life-os repo。

## 測試策略

- **分頁（client 單元）**：一頁就取完時只發一個請求；兩頁時發兩次且第二次帶 `page=2`，結果**依序串接**；**第二頁用第一頁回傳的輪替 session**（假 fetch 每次要回不同 session，否則這條恆綠）；上游回的 `pagination` 顯示還有下一頁但 `data` 是空的時要停（防無窮迴圈）。
- **重疊判斷（use case 單元）**：完全相同的起訖 → 跳過；起始日差一天但區間重疊 → 跳過；相鄰但不重疊（前一段 5/1–5/5、新的 5/6–5/10）→ 寫入；lifeos 有開放結尾的期間 → 之後的都跳過；沒有既有資料 → 全寫。
- **與日期分批疊加**：長區間（>183 天）會對 client 發多次 fetch，且 `signIn` 只有一次（比照既有五個 importer 的回歸點）。
- **失敗語意**：某批／某頁失敗 → 整個拋、**不部分寫入**（寫入在所有抓取之後）。
- **既有測試不得退化**：689 passed 是基準。

## 不做（YAGNI）

- 匯入 `days` 與 `content` —— lifeos 沒有對應欄位。
- 用 `users/menstruals/dashboard` 的 `avg_days`／`avg_interval` —— lifeos 自己算週期統計。
- 補上既有期間缺的結束日 —— 見 D2，使用者選擇不覆蓋。
- 為生理期擴充 `MenstrualRepository`（range 查詢、`addMany`）—— 見 D3／D4。
- 前端的類型選擇與 UI —— 另一個 change。
