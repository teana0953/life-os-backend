# 目標

七處把原始 error 物件直接寫進 `console.error` 的地方,繞過了既有的遮蔽。開啟 Workers Logs 之後這些訊息會被**保存 3 天**,不再只是短暫出現。

專案:life-os-backend —— Cloudflare Workers(Free 方案)+ Hono + drizzle-orm(neon-http)+ Neon Postgres,TypeScript。

## 前提:同一個分支已經有一個未 commit 的改動

`wrangler.toml` 已加入 `[observability] enabled = true` / `head_sampling_rate = 1`(啟用 Workers Logs)。**那個改動已經過 review、不要動它**,它只是這次任務的**理由**:日誌從「產生後蒸發」變成「保留 3 天」。

## 問題(我已 grep 確認,以下清單是權威版本)

```
contexts/split/application/mirror-aftermath.ts:16        console.error("split mirror afterWrite failed", err);
contexts/finance/application/settle-installment-plan.ts:72   console.error("budget alert check failed", err);
contexts/finance/application/create-transaction.ts:42        console.error("budget alert check failed", err);
contexts/finance/application/update-transaction.ts:123       console.error("budget alert check failed", err);
contexts/finance/application/check-budget-alerts.ts:77       console.error("budget alert push failed", err);
contexts/finance/application/update-installment-plan.ts:82   console.error("budget alert check failed", err);
contexts/finance/adapters/finance-shares-mirror.ts:154       console.error("budget alert check failed for a split mirror", { userId: row.userId, error });
```

**注意最後一個在 `adapters/`,前六個在 `application/`** —— 這個區別是本題的關鍵,見下。

為什麼危險:drizzle 的 query error 會把 **`params: ...`(SQL 綁定值)**接在 message 後面,而 `redact()` 存在的理由正是清掉它。這七條路徑上那層過濾**一行都沒跑**。最後一個還額外記了 `userId`。

對照組(寫法正確、五個站點):`contexts/notifications/adapters/workflows-care-day-instance-manager.ts` 與 `care-reminder-workflow.ts` 都走 `describeErrorChain(err)`。

## 本題真正的難點(我已查證,不要重新發現)

`describeErrorChain` / `logInternalError` 住在 **`src/adapters/http/error-logging.ts`**。

而 `test/architecture/dependency-rule.test.ts` 有一條 **`keeps domain and application out of shared/ and adapters/`** —— 所以**前六個站點(在 `application/`)不能 import 它**,一 import 測試就紅。

也就是說:**那六處直接記 raw err,很可能不是疏忽,而是正確的 helper 在分層規則下拿不到。** 對照組那五處之所以寫得對,是因為它們在 `adapters/` 裡。

已查證的兩個相關事實:

- `src/adapters/http/error-logging.ts` **零 import,是純函式模組**(只有 `describeErrorChain` 與 `logInternalError` 兩個 export)
- CLAUDE.md 明訂:`shared/` 是跨 context 的**基礎設施**(有 I/O/連線)、inner layer 不可 import;而 **`shared-kernel/` 放的是純粹、無依賴、多個 context 都需要的邏輯,domain/application 可以 import**。目前 `src/shared-kernel/` 只有 `reminder-clock.ts`

## 你要自己決定的(不要照抄我的推測)

1. **遮蔽邏輯該住在哪。** 搬到 `shared-kernel/`?在 application 層另做一份?讓 application 不要自己記日誌、改由呼叫端處理?各自的代價是什麼。**若你選擇搬動 `error-logging.ts`,要注意它現在被 HTTP 的 `onError` 使用,且有自己的測試。**

2. **`redact()` 已知的缺口要不要一起補。** `error-logging.ts` 的檔頭自己載明:redact() **不清理** Postgres 直接嵌在 message 裡的 row value(例如 `invalid input syntax for type uuid: "<value>"`)。那個取捨當初是在「**日誌會蒸發**」的前提下做的 —— 而本次改動把前提換掉了。要補、還是明確記錄為已知殘餘?**兩者都可以,但必須是有意識的決定,不能默默沿用。**

3. **遮蔽到什麼程度才不會反過來讓事故查不出來。** 這是真正的取捨:今天早上那次事故之所以能定位到 `plan-next-wake-4` 與唯讀查詢,靠的就是錯誤鏈裡的資訊。**遮過頭會讓下一次事故變成「有一個錯誤,不知道是什麼」。** 請說明你的界線在哪、為什麼。

4. **`finance-shares-mirror.ts:154` 額外記了 `userId`。** 那是識別個人的資料嗎?在這個單人 app 的脈絡下值不值得留?說明理由。

## 驗證

- `npm run typecheck` 綠
- `npx vitest run --no-file-parallelism` 全綠 —— **基準 130 檔 / 1574 條**,回報實際數到的數字
- **架構守門必須仍然綠**:`test/architecture/dependency-rule.test.ts` 的 `keeps domain and application out of shared/ and adapters/`。若你的修法讓它紅,那個修法就是錯的
- **每一處都要有能被突變殺死的守門**:把某一處改回 `console.error("...", err)`,對應測試必須紅。**七處都要**,不是抽驗
- 若你補了 redact() 的缺口,那個補法也要有突變:拿掉它,對應測試必須紅
- 遮蔽的測試要用**真實形狀的 fixture** —— drizzle 的 query error 實際長什麼樣(message 後面接 `params: ...`)、pg 的 `invalid input syntax for type uuid: "..."`。假的 fixture 會讓遮蔽看起來有效而實際漏掉

## 專案規範

- 遵守 repo 根的 CLAUDE.md 與 life-os-backend/CLAUDE.md,特別是 **Clean Architecture 的依賴規則**與剛新增的 **Comments 一節**(預設不寫註解;要寫就寫程式碼說不出的東西,每個數字都要有來源)
- **不要動 `wrangler.toml`**(已完成、已 review)
- **surgical**:不要順手改其他 `console.error`、不要重構錯誤處理以外的東西
- 這個 repo 反覆長出「不可能失敗的守門」與「註解比事實強」。每寫一條守門就突變確認;每寫一句註解都要能被程式碼支持
