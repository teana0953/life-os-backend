# 目標

修正 PR #110 留下的三處文件錯誤。**只改文件,一行程式碼都不動。**

專案:life-os-backend —— Cloudflare Workers + Hono + drizzle-orm + Neon Postgres,TypeScript。

## 為什麼:前端實作時發現契約寫錯了

前端(`life-os` repo)正在實作 `web/push_sw.js` 的 ack。過程中發現 PR #110 寫下的交接契約有一處**會讓照著做的人整個功能不會動**,另兩處與實際落地的做法不一致。

## 第一處(最嚴重):`if (data?.ack)` 的層級是錯的

`openspec/changes/add-push-delivery-ack/design.md:193`:

> 2. **In the `push` handler**: parse the payload; `if (data?.ack)` then post the ack.

**實際的 wire payload 是 `{title, body, data: {ack}}`。** 我已讀過原始碼確認:

- `src/contexts/notifications/adapters/web-push-sender.ts:115`
  `JSON.stringify({ title: message.title, body: message.body, data: message.data })`
- `src/contexts/notifications/application/run-care-day.ts:249`
  `data: { ack: ackToken }`

而 service worker 裡的慣用寫法是 `var data = event.data.json()`,那個 `data` **就是整包 payload**。所以 token 在 **`data.data.ack`**,不是 `data.ack`。

**照這份契約寫,ack 會對每一則推播都不觸發**,而且測試會全綠(因為守門的 fixture 也會照同一個錯誤形狀寫)。前端是靠 harness 第一次 smoke run 記到 `fetch` 次數 0 才抓到的。

修法:把那一行改成不會被誤讀的寫法。**你要自己決定怎麼寫最不容易再被誤讀** —— 例如明確標出 payload 的完整形狀、或用不同的變數名區分「整包」與「`data` 欄位」。

順帶檢查 `design.md:184`(「a payload with no `data.ack`」)在新的寫法下是否仍然一致。

## 第二處:`Content-Type` 與實際落地的不同,而且是刻意的

`design.md:189-190` 寫 `Content-Type: application/json`。

前端**刻意改用 `text/plain`**,理由是量出來的,不是偏好:

- `text/plain` 是 CORS 安全名單內的值(Fetch Standard 2.2.2),所以那個 POST 是 **simple request、不送 preflight**。
- 前端實測:從**不在允許清單**的 origin(每一個 Cloudflare Pages preview 部署都是),`application/json` 會先送 preflight,拿不到 ACAO,**POST 根本不會離開瀏覽器**;而 `text/plain` 的 simple POST **仍然打得到 handler**,只有那個「本來就沒東西可判斷」的回應被擋。
- 這一側完全不受影響:`src/adapters/http/routes/push-ack.ts` 讀 `c.req.text()` 再 `JSON.parse`,**從不檢查 `Content-Type`**(你要自己去讀這個檔確認)。

修法:把契約改成記錄實際的做法**與那個理由**。**這一點特別重要**:如果只寫「用 text/plain」而不寫為什麼,下一個人看到與 body 是 JSON 不一致,很可能會「順手修正」回 `application/json`,而那會在 preview 環境上靜默弄壞 ack。

## 第三處:runbook 要說明 `acked_at IS NULL` 還有別的來源

`docs/runbooks/push-delivery-ack.md:11-12` 目前只講了一個來源:

> **前端 `web/push_sw.js` 上線前,`acked_at` 全部是 `NULL`,而那代表「沒有人回報」,不代表「沒送到」。**

前端查證後發現**還有兩個**,而且第二個在上線後會持續一段時間:

1. **舊註冊不會自己換 URL(主要來源)**。前端把 API base URL 放在 service worker 的 script URL query 上(`push_sw.js?api=...`)。這次改動**之前**建立的註冊,script URL 是**沒有 query 的** `push_sw.js`;瀏覽器定期的位元組比對更新抓的是**同一個 URL**,所以那些註冊會拿到新的 worker **程式碼**、卻永遠讀不到 `?api=`,ack 端點解析為 null。URL 只有在前端重新呼叫 `register()` 時才會換,而那發生在冷啟(暖回前景可能被抑制窗跳過)。**淨結果:既有裝置是一台一台、從各自下次冷啟才開始回報。**
2. **更新期間的空窗**。新舊 worker 交接時,瀏覽器把 push 派給**當下 active 的那個**,可能是舊的、沒有 ack 的 worker。這個**在頁面端修不了**(等待新 worker 啟用並不會改變瀏覽器派給誰),所以是已知殘餘,不是待辦。

修法:把這兩個來源寫進那段。**目標讀者是「盯著這張表想下結論的人」** —— 要讓他知道看到 NULL 時有哪幾種可能,而不是只知道「前端還沒上線」這一種。

## 明確不要做的

- **不要改任何 `.ts` 檔**,不要改 schema、migration、測試。
- 不要動 `openspec/specs/web-push/spec.md`(除非你發現它也有同一個錯誤,那要先講出來)。
- 不要「順手」重寫 design.md 其他段落。
- 不要碰 `life-os` repo(可以讀,不可以寫)。

## 驗證

- `npm run typecheck` 綠(應該不受影響)
- `npx vitest run --no-file-parallelism` 全綠 —— **基準 137 檔 / 1629 條**;純文件改動**不應該讓任何數字變動**,若變了就停下來說明
- **這一輪沒有可以突變的守門** —— 文件沒有測試。所以驗證方式是:**逐句對照原始碼**,確認你寫下的每一句都能被程式碼支持。特別是:
  - `data.data.ack` 這個層級,對照 `web-push-sender.ts:115` 與 `run-care-day.ts:249`
  - 「後端從不檢查 Content-Type」,對照 `routes/push-ack.ts`
  **這個 repo 反覆長出「註解/文件比事實強」,而這次要修的正是那個病。不要用另一個沒查證的敘述取代它。**

## 專案規範

- 遵守 repo 根的 CLAUDE.md 與 life-os-backend/CLAUDE.md
- design.md 是**未 archive 的 change 文件**,所以直接改正文、不要加新的 D 編號
- **surgical**:只碰上面三處
