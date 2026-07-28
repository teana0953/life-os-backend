## Why

[issue #85](https://github.com/teana0953/life-os/issues/85)：「[匯入 chaodays] 增加生理期」。chaodays 匯入目前支援五種（體重／飲食＋血糖／飲水／排便／飲食目標），生理期是第六種。

研究 `https://chaodays.app/tw/user/period` 的前端 bundle 後確認來源存在：

```
GET users/menstruals?start_date=&end_date=&page=1&per_page=20
→ data[]: { id, started_date, ended_date, days, content }
```

## What Changes

- **`ChaodaysClient` 加 `fetchMenstruals`**，並在 **client 內部跑分頁迴圈**。這個端點與其他五個不同：前端呼叫 weight／water／defecation／diet_records／diet_menus 時只帶日期，唯獨 menstruals 帶 `page` + `per_page`，而現有的五個 `fetch*` 完全沒讀回應信封裡的 `pagination`、只取 `data` —— 照抄那個寫法會在資料超過一頁時**靜默漏掉**。停止條件不讀信封（我們不知道它的鍵名，猜錯的失敗方式正好是「只抓第一頁」而且測試看不出來），也不用「不足 requested 就是最後一頁」（賭上游不會後置過濾，輸了一樣是靜默漏抓）—— 改成翻到某頁回 0 筆為止，外加每批 20 頁硬上限。迴圈內串接每次回應輪替的 session，與 PR #54 的日期分批疊加時仍然正確。
- **新增 `importChaodaysMenstrual`**：分批抓完 → 讀既有期間 → 濾掉**日期重疊**的 → 逐筆寫入。
- **新增 `POST /api/import/chaodays/menstrual`**，形狀比照既有五個。

**重疊而非起始日相同**：兩邊各自記錄同一次生理期時起始日很容易差一天（lifeos 記 5/1、chaodays 記 5/2），用起始日當鍵會建立兩段重疊期間，把平均週期與預測算歪 —— 而那正是這份資料的用途。比較的基準不只是 lifeos 既有資料，還包含**這次匯入已經接受的期間**與**來源的 `id`**：長區間會被切成多個 183 天批次，而橫跨邊界的那一次生理期可能被上游在兩個批次各回一次；其他五種匯入靠 day-key Map 天然去重，生理期沒有那層保護。與既有匯入「已有資料就不覆蓋」的決策一致；代價是 lifeos 那筆若還沒填結束日也不會被補上（使用者確認接受）。既有規格要求「同一區間單批與多批的 summary 必須相同」，而生理期是第一個會跨批次收到同一筆的匯入 —— 所以計數要先依 `id` 去重再算，這也是 `id` 去重真正撐住的東西。

**還沒結束的來源期間不匯入**：它是還會變的資料，而且照抄成 lifeos 的開放期間後，依上面的重疊規則會**永久壓住之後所有匯入** —— 使用者下個月會安靜地什麼都匯不進來，且要手動編輯才解得開。跳過它的代價只是「等它結束再匯一次」，自癒。

`days` 與 `content` 丟掉（lifeos 沒有對應欄位，比照既有匯入丟掉 chaodays 的 oil/sugar）。生理期筆數少（一年約 12 筆），所以讀取用既有的 `listByUser`、寫入逐筆走既有的 `addPeriod` use case（`endDate >= startDate` 這條不變量的守門處），不為它擴充 port 或做 batch。

前端（`ImportType.menstrual` + UI 列 + l10n）是 life-os repo 的另一個 change。Gate = `npm test` + `npm run typecheck`。

## Capabilities

### Modified Capabilities

- `chaodays-import`: 匯入 SHALL 支援生理期；來源分頁 SHALL 被完整取完且有上限；與已知期間日期重疊者 SHALL 跳過；尚未結束的來源期間 SHALL 不匯入；summary SHALL 與批次切法無關。
