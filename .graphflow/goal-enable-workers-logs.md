# 目標

啟用 Cloudflare Workers Logs(observability),讓已經在寫的日誌**事後查得到**。

專案:life-os-backend —— Cloudflare Workers(Free 方案)+ Hono + drizzle-orm(neon-http)+ Neon Postgres,TypeScript。

## 為什麼(今天早上的實例)

2026-08-15 08:05–08:15,Neon 的查詢連續失敗約 10 分鐘,把提醒鏈條那顆 workflow instance 弄死了(`care-day_04e566e5..._2026-08-15`,Errored)。失敗的 step 是 `plan-next-wake-4`,查詢是唯讀的 `select ... from care_schedule inner join care_item`,**每次都在 1 秒內失敗**(與 PR #104 的重試排程 0/200/600ms + 25% 抖動跑完 4 次的時間吻合 —— 也就是重試有跑、然後耗盡)。

**但我無法查到當時的日誌。** PR #104 在 `src/shared/db/retry-fetch.ts` 加了三行 `console.warn`:

```
[db] transient failure, retrying: attempt N/4 ... delay=Nms
[db] retries exhausted after 4 attempts: ...
[db] transient failure not retried (body is not read-only): ...
```

`wrangler.toml` **沒有 `[observability]` 區塊**,所以 Workers Logs 是關的,那些訊息只有在有人剛好開著 `wrangler tail` 的當下才看得到,**產生後即蒸發**。

也就是說,PR #104 的說明裡寫的「重試會記 log,那是日後判斷根因需要的資料」**當時就不成立** —— 資料根本沒有被保存。這次要補上。

## 已經替你查證過的(不必重查)

- `wrangler.toml` 目前只有 `name` / `main` / `compatibility_date` / `compatibility_flags` / `[triggers]` / `[[workflows]]`,**沒有任何 `[observability]`**
- 本機 wrangler 版本 **4.111.0**
- 今天的 errored instance 是靠使用者 08:30 剛好編輯排程觸發 restart 才補回來的;**若沒有那個動作,10:00 / 20:00 / 21:30 三個提醒都不會發出,而且不會有任何跡象**(這次沒漏,`care_occurrence` 顯示兩個 slot 都 `sent`)

## 要做的

在 `wrangler.toml` 加上 observability 設定,讓日誌被保存並可查詢。

**細節由你決定,但要查證後說明依據,不要從記憶或直覺寫:**

1. **正確的設定鍵與形狀。** `[observability]` 的欄位有哪些(`enabled`、`head_sampling_rate`、以及新版的 `[observability.logs]` 子區塊如 `invocation_logs`)?**去讀實際的 schema 或官方文件確認**,不要照抄別處看來的片段。這個 repo 反覆因為「文件/型別說可以、真 API 不接受」而上線後完全不運作。
2. **取樣率。** `head_sampling_rate` 預設是多少?這個 app 的流量很低(單人使用),要不要設 1(全採)?若設 1 有什麼代價?
3. **`invocation_logs`。** 每次呼叫的摘要日誌要不要保留?它會顯著增加筆數,但也是「這個請求發生過」的唯一證據。權衡後說明。
4. **免費方案的限制。** Workers Logs 在 Free 方案的每日筆數上限、保留天數各是多少?以這個 app 的量級會不會撞到?**要有實際依據,不要估。**
5. **會不會有敏感資料進日誌。** `retry-fetch.ts` 的 warn 訊息裡有 `shape=` 與 failure 描述;`src/adapters/http/error-logging.ts` 有 `describeErrorChain` 與遮蔽邏輯(連線字串、params、pg 的 `Key (...)=(...)` 都會被遮)。開了 Workers Logs 之後這些訊息會被**保存**而不只是短暫出現 —— 請確認現有的遮蔽足夠,若發現有洩漏風險就明講(**但不要在這次改動裡順手改那些檔案**,那超出範圍;寫進報告即可)。

## 驗證

- `npm run typecheck` 綠
- `npx vitest run --no-file-parallelism` 全綠 —— **基準要自己先跑一次未改動的版本並記下檔數/條數**,改完再跑一次確認沒有變動(這個改動不應該影響任何測試)
- **設定本身要能被驗證真的生效**,而不只是「檔案裡有那幾行」。至少做到:`npx wrangler deploy --dry-run` 之類不會實際部署的檢查能通過而且不報未知欄位;若有辦法在不部署的情況下驗證 schema(例如 wrangler 對未知鍵會不會警告),說明你怎麼確認的。
  **注意**:真正的驗證要等部署後在 dashboard 看得到日誌,那一步由使用者做,不在這次範圍 —— 但**不要因此就宣稱「已啟用」**,報告要誠實區分「設定已寫入」與「已驗證生效」。

## 專案規範

- 遵守 repo 根的 CLAUDE.md 與 life-os-backend/CLAUDE.md
- **surgical**:只動 `wrangler.toml`。不要改任何 source、不要改日誌訊息、不要「順手」調整 cron 或 workflows 設定
- 這個 repo 反覆長出「註解比事實強」。`wrangler.toml` 現有的註解都是有內容的(說明 cron 為什麼降級成修復網、workflow 為什麼一天一個 instance)—— 新加的註解要同樣說明**為什麼**(今天這次事故),而不是複述設定鍵的名字。每一個數字都要有來源
