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

**停止條件不讀 `pagination`**：我們只知道信封裡有這個欄位，不知道它的鍵名（`pages`?`last`?`next`?）。猜錯鍵名的失敗方式是**只抓第一頁就停** —— 正好是這個 change 要修的漏抓，而且假 fetch 的信封是照實作寫的，那條測試會恆綠、抓不到。

改用不依賴信封的規則：**`per_page` 固定帶 20，回傳筆數 < 20（含 0）就是最後一頁。** 20 是 chaodays 自己的前端在用的值 —— 我們觀察到它被原樣接受，所以「不足 20 = 沒有下一頁」成立。不要為了少幾次請求改成 `per_page=100`：若上游把它 cap 回 20，第一頁就會「不足 100」而提早停，一樣是靜默漏抓，而且從測試看不出來。

外加**硬上限 100 頁** → 超過丟 `ChaodaysUpstreamError("pagination")`。上游若回一個永遠滿頁的迴圈，寧可失敗也不要無窮請求打爆 Worker 的 subrequest 額度。

**實務上大概不會真的翻頁**：生理期資料稀疏，一個 183 天批次約 6 筆。但正確性不能靠資料密度。

**必須走既有的 `this.request`**（不是直接 `fetchImpl`），否則會漏掉 relay 的 base URL 與 `X-Relay-Secret`。

### D2 — 重疊就跳過，不覆蓋

匯入是冪等的：chaodays 的一段期間若與**任何已知的**期間日期重疊，就跳過不寫。「已知」有三個來源，缺一不可：

1. lifeos 既有的期間（`listByUser`）。
2. **這次匯入已經接受的期間** —— 逐筆累積進比較集合。
3. **來源自己的重複** —— 用 chaodays 的 `id` 去重。

第 2、3 點不是防禦性多寫的：`fetchInBatches` 會把長區間切成多個 183 天批次，而我們並不知道上游的 `start_date`/`end_date` 是依 `started_date` 篩還是依「期間有重疊」篩。若是後者，橫跨批次邊界的那一次生理期會在兩個批次各回一次 —— 兩筆日期相同，兩筆都寫入，做出兩段完全重疊的期間，正是這條決策要防的統計汙染。其他五種匯入是用 day-key Map 天然去重的，生理期沒有那層保護。

用「重疊」而非「起始日相同」：兩邊各自記錄同一次生理期時，起始日很容易差一天（lifeos 記 5/1、chaodays 記 5/2）。用起始日當鍵會建立兩段重疊的期間，把平均週期與預測算歪 —— 而那正是這個資料的用途。

與既有五種匯入的決策一致（已有資料就不覆蓋）。代價：lifeos 有一段「還沒結束」的期間、而 chaodays 那邊已有完整起訖時，**結束日不會被補上** —— 使用者確認過接受。

**日期是閉區間**，所以相鄰不算重疊：既有 5/1–5/5、來源 5/6–5/10 → 寫入。ISO 日期字串可直接比大小。

### D2a — 沒有結束日的期間

`endDate == null` 在兩邊都可能出現，語意不同，處理也不同：

**lifeos 既有的開放期間** → 重疊判斷上視為**延伸到無限遠**。任何晚於它的來源期間都算重疊而跳過。保守的正確方向（不確定時不寫）。

**來源的開放期間 → 整筆不匯入。** 它代表「chaodays 上這次生理期還沒結束」（或使用者忘了關），是**還會變的資料**。若照抄成 lifeos 的開放期間，依上一段的規則它會**永久壓住之後所有匯入** —— 使用者下個月再匯入，會安靜地什麼都匯不進來，而且看不出原因。跳過的代價只是「等它結束後再匯一次就有了」，自癒；寫進去的代價是要人工發現並手動編輯才解得開。

### D3 — 讀既有期間用 `listByUser`，一次讀完

`MenstrualRepository` 沒有 range 版本的查詢，只有 `listByUser(userId)`（全部、依 `startDate` 升冪）。生理期資料量小（一年約 12 筆），一次讀完可接受，也省得為這個 change 擴充 port。

讀取發生在**所有批次抓完之後、寫入之前**，與其他五個 importer 相同 —— 一次失敗代表完全沒寫，重跑是乾淨的重跑。

### D4 — 寫入走既有的 `addPeriod` use case，逐筆

`MenstrualRepository` 沒有 `addMany`。生理期筆數少（183 天約 6 筆、三年約 36 筆），逐筆寫的 subrequest 數遠低於上限，不值得為它擴充 port 或做 batch。這與其他五個 importer 的 `db.batch` 慣例不同，理由是資料量級差兩個數量級（飲食是 O(天×餐×品項)，生理期是 O(週期)）。

**走 `addPeriod` 而不是直接 `repository.add`**：`addPeriod` 是 `endDate >= startDate` 這條不變量的唯一守門處（`InvalidPeriodError`），繞過它等於讓匯入成為手動新增做不到的後門。

搭配這點，**`ended_date` 早於 `started_date` 的來源紀錄在 client 就當成 `ChaodaysUpstreamError("parse")`** —— 與其他五個 fetch 對畸形紀錄的處理一致，而且發生在任何寫入之前，所以不會半寫。`ended_date` 是空字串時正規化成 `null`（Rails 序列化 nil 通常是 null，但空字串會讓日期比較整個錯亂）。

## 元件

| 檔案 | 改動 |
| --- | --- |
| `domain/chaodays-client.ts` | 加 `ChaodaysMenstrualRecord` 與 `fetchMenstruals` |
| `adapters/http-chaodays-client.ts` | 實作，含**分頁迴圈**與 session 串接 |
| `application/import-chaodays-menstrual.ts`（新） | use case：分批抓 → 讀既有 → 濾掉重疊 → 逐筆 `addPeriod` |
| `adapters/http/routes/import-chaodays.ts` | 新增 `POST /api/import/chaodays/menstrual` |
| `adapters/http/app.ts` | 把 `menstrualRepository` 也傳給 import 路由的 options |

`src/index.ts` **不用改** —— 第 70 行已經建了 `DrizzleMenstrualRepository`、第 97 行已經傳給 `createApp`。

前端（`ImportType.menstrual` + UI 列 + l10n）**是另一個 change**，在 life-os repo。

## 測試策略

- **分頁（client 單元）**：滿 20 筆 → 會發 `page=2`；第二頁不足 20 → 停；第一頁不足 20 → **只發一個請求**；回 0 筆 → 停；**第二頁帶的是第一頁回傳的輪替 session**（假 fetch 每次要回不同 session，否則這條恆綠）；一直回滿頁 → 打到 100 頁上限後丟 `pagination`。**假 fetch 不要回 `pagination` 信封** —— 停止條件不該讀它，回了就掩蓋掉「實作偷讀信封」這個 bug。
- **重疊判斷（use case 單元）**：起訖完全相同 → 跳過；起始日差一天但重疊 → 跳過；相鄰不重疊（5/1–5/5 vs 5/6–5/10）→ 寫入；lifeos 有開放期間 → 之後的都跳過；來源是開放期間 → 不匯入；**同一次匯入內兩筆重疊 → 只寫一筆**；**兩個批次回同一個 `id` → 只寫一筆**；沒有既有資料 → 全寫。
- **與日期分批疊加**：長區間（>183 天）會對 client 發多次 fetch，且 `signIn` 只有一次（比照既有五個 importer 的回歸點）。
- **失敗語意**：某批／某頁失敗 → 整個拋、**寫入 0 次**。這條的 setup 要釘死：第一批必須回**至少一筆會被寫入**的期間（否則邊抓邊寫的實作也是 0 次寫入，測試假綠），並配一條同樣資料但不失敗的測試斷言 `imported === 1`，兩條互相釘住。
- **既有測試不得退化**：689 passed 是基準。

## 不做（YAGNI）

- 匯入 `days` 與 `content` —— lifeos 沒有對應欄位。
- 用 `users/menstruals/dashboard` 的 `avg_days`／`avg_interval` —— lifeos 自己算週期統計。
- 補上既有期間缺的結束日 —— 見 D2，使用者選擇不覆蓋。
- 匯入「還沒結束」的來源期間 —— 見 D2a。
- 為生理期擴充 `MenstrualRepository`（range 查詢、`addMany`）—— 見 D3／D4。
- 前端的類型選擇與 UI —— 另一個 change。
