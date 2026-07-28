## Why

[issue #85](https://github.com/loftapartment/life-os/issues/85)：「[匯入 chaodays] 增加生理期」。chaodays 匯入目前支援五種（體重／飲食＋血糖／飲水／排便／飲食目標），生理期是第六種。

研究 `https://chaodays.app/tw/user/period` 的前端 bundle 後確認來源存在：

```
GET users/menstruals?start_date=&end_date=&page=1&per_page=20
→ data[]: { id, started_date, ended_date, days, content }
```

## What Changes

- **`ChaodaysClient` 加 `fetchMenstruals`**，並在 **client 內部跑分頁迴圈**。這個端點與其他五個不同：前端呼叫 weight／water／defecation／diet_records／diet_menus 時只帶日期，唯獨 menstruals 帶 `page` + `per_page`，而現有的五個 `fetch*` 完全沒讀回應信封裡的 `pagination`、只取 `data` —— 照抄那個寫法會在資料超過一頁時**靜默漏掉**。迴圈內串接每次回應輪替的 session，與 PR #54 的日期分批疊加時仍然正確。
- **新增 `importChaodaysMenstrual`**：分批抓 → 讀既有期間 → 濾掉與既有**日期重疊**的 → 逐筆寫入。
- **新增 `POST /api/import/chaodays/menstrual`**，形狀比照既有五個。

**重疊而非起始日相同**：兩邊各自記錄同一次生理期時起始日很容易差一天（lifeos 記 5/1、chaodays 記 5/2），用起始日當鍵會建立兩段重疊期間，把平均週期與預測算歪 —— 而那正是這份資料的用途。與既有匯入「已有資料就不覆蓋」的決策一致；代價是 lifeos 那筆若還沒填結束日也不會被補上（使用者確認接受）。

`days` 與 `content` 丟掉（lifeos 沒有對應欄位，比照既有匯入丟掉 chaodays 的 oil/sugar）。生理期筆數少（一年約 12 筆），所以讀取用既有的 `listByUser`、寫入逐筆 `add`，不為它擴充 port 或做 batch。

前端（`ImportType.menstrual` + UI 列 + l10n）是 life-os repo 的另一個 change。Gate = `npm test` + `npm run typecheck`。

## Capabilities

### Modified Capabilities

- `chaodays-import`: 匯入 SHALL 支援生理期；來源分頁 SHALL 被完整取完；與既有期間日期重疊者 SHALL 跳過。
