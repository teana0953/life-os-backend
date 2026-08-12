# 目標

讓 `restartToday` 找得到並終止自己上一次建立的 instance,使一個 (user, local day) 最多只有一個 `CareReminderWorkflow` instance 活著。

專案:life-os-backend —— Cloudflare Workers(Free 方案)+ Hono + drizzle-orm(neon-http)+ Neon Postgres,TypeScript。

## 問題(正式環境實測,不是推論)

PR #100 修 Bug B 時,把 `restartToday` 改成用 `care-day_{userId}_{localDate}_r{randomUUID()}` 這種帶隨機後綴的 id 建立 instance —— 因為 Cloudflare 拒絕重用任何在保留期內的 id,原本「terminate 後用同一個決定性 id 再 create」必定失敗。

但 `restartToday` 要 terminate 的對象仍然是**決定性 id**:

```ts
const deterministicId = careDayInstanceId(userId, localDate);
const handle = await this.workflow.get(deterministicId);   // 找不到 _r 後綴那個
await handle.terminate();
...
const id = `${deterministicId}_r${crypto.randomUUID()}`;   // 每次都是新的
```

所以第二次以後的 restart **找不到前一次 restart 建的 instance**,前一個就一直活著。

正式環境證據(2026-08-12 17:22,同一個使用者 35 秒內存了兩次排程):

```
care-day_04e566e5..._2026-08-12_ra1ae7f78   ⏰ Waiting   17:22:51 建
care-day_04e566e5..._2026-08-12_r75812e08   ⏰ Waiting   17:22:16 建
```

兩個都在 `sleep-until-next-due-1`,都醒在 20:00。

`restartToday` 掛在三條路徑上:改排程(care-items)、改時區(user-timezone)、訂閱推播(subscribe-web-push)。**每一次編輯都會多留一個 instance**,累積到當地午夜。

## 危害範圍(已經查證過的,不要重新假設)

- **不會重複發送**。`claimAttempt` 的租約擋住了。實證:第二個 instance 的 `plan-next-wake` signature 裡含 `a75ebd90-...:sent`,顯示它讀得到前一個剛送出的狀態。這條**不需要再修**
- **會燒 step 額度**。Workflows 免費方案 3,000 steps/天是帳號級的,每個 instance 每次醒約 4 個 step
- **午夜每個活著的 instance 都會 spawn 明天**,決定性 id 只有一個 create 成功,其餘進 `ensureToday` 的 catch 記 error。不會壞事但會吵

## 已知的限制(這是為什麼要改 schema)

Cloudflare Workflows 的 binding API **沒有前綴列舉**(`Workflow` 型別只有 `create`/`get`/`createBatch`),所以無法從 id 反推「這個使用者今天現在活著的是哪一個」。只能自己把目前的 instance id 記下來。

## 修法方向由你決定,但至少評估這幾種並說明取捨

1. **DB 記錄目前的 instance id**:某張表存 `(userId, localDate) -> instanceId`,`restartToday` 先讀它 terminate,再建新的並寫回。缺點:多一次 DB 往返(這個專案的 Neon compute 額度很緊,見下),且要處理 terminate 成功但寫入失敗之類的部分失敗
2. **不 terminate,讓舊 instance 自己結束**:靠 instance 自己在下一次醒來時發現「我不是最新的」而退出。需要一個判別「誰是最新」的依據,還是要有共用狀態
3. 其他

**不接受**的方向:維持現狀然後把它寫進文件當已知限制。#98 已經用「已知、可接受、24 小時內自癒」把 terminate-then-create 放過一次,那個判斷是錯的;PR #100 的註解又用「multiple instances may run concurrently for a while」低估了同一件事。這是第三次,不要再低估。

## 專案上下文

- Neon 免費方案 100 CU-hr/月,額度很緊(曾因每分鐘 cron 讓 compute 不休眠而月中撞牆)。新增的 DB 往返要能說明為什麼值得
- `restartToday` 是 best-effort:失敗不能影響觸發它的那個請求的結果
- 每日 cron(`5 16 * * *` UTC = 台北 00:05)會做修復性的 `ensureToday`
- instance 自己在當地午夜會退出並 spawn 明天的(決定性 id)

## 驗證

- `npm run typecheck` 綠
- `npx vitest run --no-file-parallelism` 全綠 —— **基準 122 檔 / 1435 條**,要看到明確的檔數與條數
- 守門必須能被突變殺死。特別是:「第二次 restart 會終止第一次 restart 建的 instance」這條,把 terminate 拿掉要紅
- test/contexts/notifications/adapters/strict-workflows-fakes.ts 已經有一組模擬真實 Cloudflare 限制的替身(拒絕非正數 sleep、拒絕重用 id、拒絕未知 id、3000 步預算)。新的行為要在那組替身下也成立;如果新修法引入了替身沒模擬到的真實 API 行為,替身也要跟著補
- 碰日期時間的測試用注入的時鐘與明確時區

## 專案規範

- 遵守 repo 根的 CLAUDE.md 與 life-os-backend/CLAUDE.md(Clean Architecture + DDD、domain/application 不可 import adapters 或 shared/db)
- workflow 是 driving adapter,商業規則放 application 的純函式
- 這個 repo 反覆長出「不可能失敗的守門」與「註解比事實強」。每寫一條守門就對它突變確認拿掉修法會紅;每寫一句註解都要能被程式碼支持
- 若改動了 `openspec/changes/replace-cron-with-workflows/design.md` 描述過的決策(特別是 W1、D6''、即時生效機制),要在該文件更新,不可沉默失效。**W1 目前描述的「一個 (user, local day) 一個 instance」在 PR #100 之後已經不成立,這次要一併修正到與程式碼一致**
