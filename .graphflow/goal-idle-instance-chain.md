# 目標

讓「今天沒有任何要提醒的事」的使用者不要一直有 `CareReminderWorkflow` instance 在跑。

專案:life-os-backend —— Cloudflare Workers(Free 方案)+ Hono + drizzle-orm(neon-http)+ Neon Postgres,TypeScript。

## 症狀(使用者回報,已在正式環境查證)

使用者把 test 帳號的提醒**全部刪光**,但 workflow instance 還在。

實測那個 instance 的 step:

```
plan-next-wake-1  →  {"wakeIso":"2026-08-13T16:00:00.000Z","plannedAtIso":"2026-08-13T03:28:04.297Z","signature":""}
sleep-until-next-due-1  💤 Sleeping  →  8/14/2026, 12:00:00 AM
```

`signature` 是空字串 = 零個 slot。它睡到當地午夜。

## 成因(兩段,已讀過程式碼確認)

1. `deleteCareItem`(src/contexts/notifications/application/care-items.ts)刪除成功後**無條件**呼叫 `restartCareDayBestEffort`,不看使用者還剩幾個啟用中的排程。所以刪掉最後一項時,反而建了一個新的 instance。

2. `runCareReminderDay`(src/contexts/notifications/adapters/care-reminder-loop.ts)在當地午夜退出時**無條件** spawn 明天的:

   ```ts
   await step.do("spawn-tomorrow", async () => {
     await spawnTomorrow(nextLocalDate(localDate));
   });
   ```

   明天那個一樣沒事做,再睡再生 —— **完全沒有提醒的帳號會永遠自我延續**。

每日 cron 不是兇手:`ensureCareDayInstances` 只挑「至少有一個 enabled 排程」的使用者。

## 已經替你查證過的關鍵事實(不必重查)

- cron 走的 `listActiveSchedules`(drizzle-care-item-repository.ts:220)**只濾 `enabled = true`,沒有濾 start_date/end_date**
- 迴圈算 slot 走的是 `listActiveSchedulesForUserOn`,它額外用 `isActiveOn(schedule, localDate)` 過濾日期
- 所以 **cron 的重新種回來的網比迴圈的 slot 計算更寬** —— 「今天沒 slot 就讓鏈條結束」不會漏掉 start_date 在未來的排程,cron 會在那天(或更早)把它種回來
- `createCareItem` 也會走 `restartCareDayBestEffort`,所以新增排程時鏈條會立刻重新開始
- 昨晚(2026-08-12→13)已實機驗證 `spawn-tomorrow` 會執行、instance 會在午夜換日

## 要做的

兩個切點,兩個都要:

1. **`spawn-tomorrow` 加條件**:今天完全沒有 slot 就不要 spawn,讓鏈條自然結束
2. **`restartToday` 路徑**:使用者沒有任何 enabled 排程時不要建 instance(省掉刪除最後一項時那次沒意義的建立)

修法細節由你決定,但要說明:條件放在哪一層(domain/application 的純函式?adapter?),以及**怎麼避免把「今天沒 slot」跟「今天的 slot 都已完成」搞混** —— 後者不該讓鏈條結束嗎?請自己判斷並說理由(提示:已完成但仍在今天之內,若使用者反悔取消完成,還需要有人重新排;但那條路徑本身也會 restart)。

## 順帶發現的既有浪費(請評估要不要一併處理,不強制)

排程 `end_date` 已過但 `enabled` 仍為 true 的使用者,cron 每天照樣建一個什麼都不做的 instance。跟本題同一個症狀、不同來源。若處理成本低就一併,若會擴大範圍就明講「不做」並說理由 —— **不要默默做掉也不要默默略過**。

## 驗證

- `npm run typecheck` 綠
- `npx vitest run --no-file-parallelism` 全綠 —— **基準 123 檔 / 1451 條**,要回報明確的檔數與條數
- 兩個切點各要有能被突變殺死的守門:
  - 拿掉「沒有 slot 就不 spawn」的條件 → 對應測試必須紅
  - 拿掉「沒有 enabled 排程就不建」的條件 → 對應測試必須紅
- **反向守門同樣重要**:有 slot 的日子**必須**照常 spawn 明天;有排程的使用者 restart **必須**照常建。把條件寫死成「永遠不 spawn」「永遠不建」也要有測試紅
- 碰日期時間的測試用注入的時鐘與明確時區

## 專案規範

- 遵守 repo 根的 CLAUDE.md 與 life-os-backend/CLAUDE.md(Clean Architecture + DDD、domain/application 不可 import adapters 或 shared/db)
- workflow 是 driving adapter,商業規則放 application 的純函式
- `test/contexts/notifications/adapters/strict-workflows-fakes.ts` 有一組模擬真實 Cloudflare 限制的替身(拒絕非正數 sleep、拒絕重用 id、拒絕未知 id、3000 步預算、追蹤 running/terminated)。新行為要在那組替身下也成立
- 這個 repo 反覆長出「不可能失敗的守門」與「註解比事實強」。每寫一條守門就對它突變確認拿掉修法會紅;每寫一句註解都要能被程式碼支持
- 若改動了 `openspec/changes/replace-cron-with-workflows/design.md` 描述過的決策(特別是 W1 的鏈條自我延續、D7 的 cron 降級為修復),要在該文件更新,不可沉默失效

---

# 追加(第一版計畫被使用者在 gate 駁回後的修訂需求)

第一版計畫提出一個述詞 `canFireOnOrAfter(schedule, localDate) = enabled && (endDate === null || endDate >= localDate)`,用它決定要不要 spawn 明天。**被駁回**,理由:

**它不看 `repeatDays` 也不看 `weekInterval`。** 但真正決定「今天有沒有事做」的是 `isActiveOn`(src/contexts/notifications/domain/care-schedule.ts),那個會看:

```ts
export function isActiveOn(schedule: CareSchedule, localDate: string): boolean {
  if (schedule.repeatDays.length > 0 && !schedule.repeatDays.includes(weekdayOf(localDate))) return false;
  if (localDate < schedule.startDate) return false;
  if (schedule.endDate !== null && localDate > schedule.endDate) return false;
  const weeks = weeksSince(schedule.startDate, localDate);
  return weeks >= 0 && weeks % schedule.weekInterval === 0;
}
```

所以第一版的修法之下:

- **「每週一」的復健提醒 → 一週七天都有 instance,六天完全空轉**
- **每兩週一次 → 14 天裡 13 天空轉**

這比第一版特別討論的「start_date 在未來」常見太多,而且是**永久的常態**,不是一次性的等待期。第一版只根治了「一個排程都沒有」與「排程全過期」。

## 使用者的決定

**要真正的根治,而且併進這同一個 change**(兩者改的是同一段 `spawn-tomorrow` 邏輯,分兩次做等於改兩次同一個地方、design.md 也要寫兩次)。

## 根治的方向

讓 instance 的存在對應「真的有事要做的那一天」,而不是「日曆上的每一天」。

退出時,算出**今天之後第一個 `isActiveOn` 為真的日期**(對該使用者所有 enabled 排程取最早),然後:

- 有 → 直接 spawn **那一天**的 instance(不是明天)
- 沒有 → 鏈條結束

這樣「每週一」就是一週一個 instance;未來排程在開始日之前完全沒有 instance —— **`start_date` 那個爭議自動消失,不需要在 cron 過濾、也不必處理時區問題**,cron 退回單純的修復網。

## 這個方向要你自己解決的問題(不要只照抄上面幾句)

1. **「下一個觸發日」的純函式怎麼寫才不會錯**:`repeatDays` 空陣列 = 每天;`weekInterval` 錨定在 `startDate`(見 `weeksSince`);`endDate` 封頂;`startDate` 在未來。**掃描要有上限**(不能無限往前找),上限怎麼定、找不到時的語意是什麼,要說清楚。多條排程取最早。
2. **跨日長睡期間排程被編輯**怎麼辦。現有的 `restartToday` 是「今天」的語意,而 instance 可能睡到下個月 —— 這條路徑要重新想:編輯排程時,要終止那個睡很久的 instance 並重新安排嗎?`restartToday(userId, localDate)` 的 `localDate` 還適用嗎?指標表(`care_day_instance_pointer`,PR #101 新增,一人一列、含 `local_date`)的語意會不會需要跟著改?**這是本次最容易出錯的地方,請特別小心並寫出你的推理。**
3. **cron 的角色**:它每天為「有 enabled 排程」的使用者 `ensureToday`。若 instance 現在可能睡到未來某天,cron 每天照建「今天」的 instance 會不會反而製造出第一版要消滅的那種空轉?`ensureToday` 的條件要不要一起改成「今天真的有 slot 才建」?請一併處理並說明。
4. Cloudflare Workflows 的睡眠上限與 step 預算(免費方案 3,000 steps/天帳號級、1,024 steps/instance)有沒有限制長睡?**不要從型別或直覺推論,查證後說明依據。**

## 仍然適用的原始需求

上面「症狀」「成因」「已經替你查證過的關鍵事實」「驗證」「專案規範」各節全部仍然適用。特別是:

- 兩個方向的守門都要有,並逐一突變確認(拿掉條件會紅、寫死成永遠不 spawn 也要紅)
- 順帶項(`end_date` 已過但 `enabled` 仍為 true 造成 cron 每天空建)第一版決定要做,這個決定保留 —— 若根治的作法已經自然涵蓋它,說明即可,不必重複做
