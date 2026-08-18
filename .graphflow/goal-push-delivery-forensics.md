# 目標

`fix/push-delivery-reliability` 這個分支的 review 已經通過,但使用者在 ship gate 要求先處理兩件事才 merge。

專案:life-os-backend —— Cloudflare Workers + Hono + drizzle-orm(neon-http)+ Neon Postgres,TypeScript。

## 前提:這是既有分支的續作,不是新功能

工作區已經有一整個未 commit 的改動(送達回執機制:`push_delivery` 表、`POST /api/push/ack`、TTL/Urgency)。**那些都已經過兩輪 code review 並通過,不要重新設計、不要順手改。** 這次只做下面兩件事。

基準:`npm run typecheck` 綠、`npx vitest run --no-file-parallelism` = **137 檔 / 1628 條**全綠。

## 要做的第一件事(主體):送達紀錄不該被訂閱刪除帶走

`src/shared/db/schema.ts:633-635`:

```ts
pushSubscriptionId: uuid("push_subscription_id")
  .notNull()
  .references(() => pushSubscription.id, { onDelete: "cascade" }),
```

review 指出的問題(**這正是這個功能存在的理由被自己抵銷**):

> 重裝 PWA → push service 回 410 → `dispatchSlot` 呼叫 `deleteByEndpoint` 刪掉訂閱 → **恰好那些「從來沒有被 ack 過」的紀錄跟著 cascade 消失**。

而 PR #107 那次事故(後端記 sent、實際沒人收到,根因是重裝 PWA 清了權限)正是這個形狀。送達紀錄在最需要它的那一刻被刪掉。

review 提的替代方案是 `ON DELETE SET NULL`。**但那不是免費的,你要自己評估**:

- `push_subscription_id` 目前是 `notNull`,改 SET NULL 就得讓它可空。**誰會讀到 NULL?哪些查詢會因此需要改?**(runbook 有 per-device 查詢)
- **為什麼不能單純拿掉 FK 的 cascade**:review 已查證,沒有 cascade 的話 `deleteByEndpoint` 會撞 FK 而失敗,**把整輪 care round 帶下去**。所以「什麼都不做」不是選項。
- 其他可能:改存 endpoint 的雜湊之類的非 FK 識別、或軟刪除訂閱。**各自的代價說清楚。**
- 保住紀錄之後,**那些 NULL 的列還有沒有診斷價值?** 若答案是「沒有」,那 SET NULL 只是把資料留成垃圾,不如坦白 cascade。這一題要正面回答。

**migration 怎麼處理**:`drizzle/0035_flippant_starbolt.sql` **尚未套用到任何資料庫**(使用者刻意保留)。所以正確做法是**重新產生 0035**(刪掉舊的 sql 與 snapshot 再 `npm run db:generate`),不是疊一個 0036。前一輪已經這樣做過一次,照做。產出的 SQL 要**逐行讀過**確認只有新增、沒有 `DROP` 或對既有表的 `ALTER`。

## 要做的第二件事(小,但這個 repo 反覆因此出事):註解比事實強

`src/shared/db/schema.ts` 裡 `push_delivery` 的註解寫著 **"one row per push actually put on the wire"**。

review 查證後指出那是假的:列是在**送出之前**寫的,所以連 `failed`、甚至根本沒發出請求的情況(crypto 失敗、無 VAPID 設定會提早 return)都會留一列。任何用這張表算送達率的人都會低估。

**先自己去讀 `run-care-day.ts` 的實際順序確認 review 說的對不對**,再把註解改成與程式碼相符。**不要改程式碼去迎合註解** —— 送出前寫入是刻意的設計(ack 回來時要有列可以落),而且有測試釘住。

順帶檢查 `docs/runbooks/push-delivery-ack.md` 與 `openspec/changes/add-push-delivery-ack/design.md` 有沒有同一句話的變體。

## 明確不要做的

- **不要**處理 review 的第三項(`registerSent` 失敗被吞掉時完全不出聲)。使用者決定另開 issue。
- 不要動 TTL/Urgency、ack 路由、token 機制、任何既有測試的斷言(除非你的改動使它必須改)。
- 不要跑 `npm run db:migrate`。

## 驗證

- `npm run typecheck` 綠
- `npx vitest run --no-file-parallelism` 全綠。**基準 137 檔 / 1628 條**;改完回報實際數字,對不上就停下來說明
- **守門要能被突變殺死**:
  - 刪除一筆 push subscription 之後,它的 `push_delivery` 列**仍然存在**且 `acked_at` 的事實沒有改變 —— 把 FK 改回 `cascade`,這條必須紅。**這是本次的 LINCHPIN**
  - 刪除訂閱**不會**讓 `deleteByEndpoint` 拋錯(既有行為的回歸柵欄)
  - 這兩條**只有 DB 級(PGlite)測試殺得掉** —— application 層的假 repo 不會執行 FK。沿用 `test/db/push-delivery-ack.test.ts` 的既有 harness
- fixture 要落在區別的兩邊:一筆已 ack 的列 + 一筆未 ack 的列,訂閱刪除後兩者都要還在

## 專案規範

- 遵守 repo 根的 CLAUDE.md 與 life-os-backend/CLAUDE.md,特別是 **Comments 一節**
- **surgical**:這次只碰 schema 的那一個 FK、對應 migration、相關測試、以及那句不實的註解
- 這個 repo 記錄在案:**修守門的那輪最會長出新的壞守門**。每寫一條守門就實際突變確認
