# 目標

修掉 PR #102 記錄的殘餘風險 **(g)**:睡眠嚴重逾時的 instance 會一天一天往前走,而不是直接跳到今天。

專案:life-os-backend —— Cloudflare Workers(Free 方案)+ Hono + drizzle-orm(neon-http)+ Neon Postgres,TypeScript。

## 風險本體(逐字取自 design.md 的殘餘風險 (g),那是 PR #102 寫的)

若一個 instance 醒來時,當地日期已經**晚於**它自己的 `params.localDate`(平台延遲送出喚醒、或 instance 跨越了一段中斷),迴圈的退出條件立刻成立、`planNextWake` 對那天回 `null`,於是它馬上 spawn 下一個 care day。如果那個後繼的日子**也還在過去**,它也做同樣的事,如此反覆 —— 形成一串快速的 instance 建立,直到追上今天為止。

design.md 的 (g) 已經誠實寫了四點:

- **(a) 不是 PR #102 引入的。** 舊碼的 `spawnTomorrow(nextLocalDate(localDate))` 形狀完全相同
- **(b) PR #102 拉長了曝險窗口。** 在那之前,一個 instance 自己的睡眠最多到明天,所以逾時要超過大約一天才可能觸發;現在 cron 與鏈條都會建立最長睡 `CARE_CHAIN_HORIZON_DAYS`(90)天的 instance,喚醒可能對著一個久遠得多的目標送達,追趕的長度相應變長 —— 上限是 instance 的 `localDate` 與今天之間的天數,而這個設計沒有為它設任何上限
- **(c) 目前沒有守門。** 沒有測試、沒有上限;唯一的兜底是每一跳都是獨立的 instance、各有自己的 step 預算,所以不會炸掉單一 instance 的 1,024 步,但會消耗 create 次數與(短暫的)並行名額
- **(d) 要修的話**,方向是讓逾期的情況**用跳的而不是用走的**:instance 醒來發現 `today > params.localDate` 時,從**今天**重新推導下一個目標(跟 cron 做的是同一個掃描),而不是從 `localDate + 1` 開始 —— 這樣不論喚醒落後多遠,追趕都只要一跳

**(d) 就是本次要做的事。** 但**不要把它當成已證明的正確答案照抄**,見下方「你要自己解決的問題」。

## 已經替你查證過的關鍵事實(不必重查)

- 相關程式碼在 `src/contexts/notifications/adapters/care-reminder-loop.ts`(退出段 `spawn-next-care-day`)與 `src/contexts/notifications/application/care-day-chain.ts`(`planNextCareChainDate`)
- 後繼函式是 `nextCareChainDate(schedules, afterLocalDate)`(`src/contexts/notifications/domain/care-schedule.ts`),**掃描起點嚴格不含 `afterLocalDate` 本身**,回傳 `after+1 .. after+90` 之內的日期或 `null`
- cron(`ensure-care-day-instances.ts`)的錨點是 `previousLocalDate(todayLocalDate)`,**所以它會把「今天」也納入候選** —— 這正是 (d) 說的「跟 cron 做的是同一個掃描」
- 檢查點落在全域 90 天格線(`epochDayOf(date) % CARE_CHAIN_HORIZON_DAYS === 0`),horizon 與格線模數是同一個常數,結構上不會分歧
- 迴圈開頭有「前導睡眠」段(`plan-day-start-wait` / `sleep-until-day-start`),讓為未來日建立的 instance 先睡到自己那天才進主迴圈;對今日 instance 是 `waitMs = 0` 且**完全不呼叫 sleep**(嚴格替身會拒絕非正數 sleep,那就是那條的守門)
- 測試基準:`npx vitest run --no-file-parallelism` → **126 檔 / 1486 條**全綠
- 這個分支的 base 應該是 PR #102 merge 之後的 main

## 你要自己解決的問題(不要只照抄 (d))

1. **「今天」要從哪裡來?** 迴圈裡取得當下時間的方式、以及它必須在 `step.do` 之內才有 replay 決定性 —— 這個 repo 的既有論證是 D1'。從今天重新推導的那次掃描,要放在哪一個 step?會不會與既有的 `spawn-next-care-day` step 合併比較好,還是該獨立?**step 名稱若語意改變,要考慮部署時 in-flight instance 的 replay 會不會拿舊快取對上新語意**(PR #102 就為此把 `spawn-tomorrow` 改名成 `spawn-next-care-day`)。

2. **跳過去之後,被跳過的那些日子怎麼辦?** 逾時期間本來應該發生的提醒已經錯過了。`mark-missed` 的既有機制是否涵蓋它們?`markMissedForUserDay(userId, X)` 標的是**嚴格早於 X** 的未答 occurrence,而被跳過的日子若從來沒有 instance 跑過,就**根本沒有 occurrence 被 materialize**。所以「跳過去」與「一天一天走」在使用者看到的結果上有沒有差別?**如果有差別,那差別是可接受的嗎?** 請明確回答,不要迴避 —— 這是本題唯一可能讓修法比現況更糟的地方。

3. **一跳之後仍在過去的可能性。** 從今天重新推導,回傳的日期一定 ≥ 今天嗎?`nextCareChainDate` 的掃描起點是嚴格不含錨點的,若錨點取「今天」則結果 ≥ 明天,若取 `previousLocalDate(今天)` 則結果 ≥ 今天。哪一個才對?**選錯會讓「今天就該提醒的事」被跳掉一天。**

4. **與前導睡眠的互動。** 跳到的目標若是**今天**,新 instance 的前導睡眠會算出 `waitMs = 0` 而不睡 —— 正確。若目標是未來,它會睡到那天 —— 也正確。但若目標**仍在過去**(第 3 點若處理錯),前導睡眠會算出負數而 break,然後主迴圈立刻退出、再 spawn —— **級聯又回來了**。請確認你的修法不會重新打開那條路。

## 驗證

- `npm run typecheck` 綠
- `npx vitest run --no-file-parallelism` 全綠 —— **基準 126 檔 / 1486 條**,要回報明確的檔數與條數
- 守門要能被突變殺死,而且**兩個方向都要**:
  - 把「從今天重新推導」改回「從 localDate + 1 走一天」→ 必須紅(要用一個「喚醒落後很多天」的 fixture,而且斷言的是**跳的次數**或**新 instance 的目標日**,不是只斷言最後有沒有追上)
  - 把它改成「永遠從今天重新推導」(連沒有逾時的正常情況也是)→ 也必須紅,因為正常情況下的後繼是從 `localDate` 推導的,改掉會讓當天剛結束就跳過明天
- **級聯守門要保住**:PR #102 那條 `an instance created for a FUTURE care day sleeps until that day starts...` 必須仍然綠,而且拿掉前導睡眠仍然要紅
- 碰日期時間的測試用注入的時鐘與明確時區

## 專案規範

- 遵守 repo 根的 CLAUDE.md 與 life-os-backend/CLAUDE.md(Clean Architecture + DDD、domain/application 不可 import adapters 或 shared/db)
- workflow 是 driving adapter,商業規則放 application/domain 的純函式
- `test/contexts/notifications/adapters/strict-workflows-fakes.ts` 的嚴格替身(拒絕非正數 sleep、拒絕重用 id、拒絕未知 id、步數預算、追蹤 running/terminated)是這條功能鏈的主要防線,新行為要在它底下成立
- 這個 repo 反覆長出「不可能失敗的守門」與「註解比事實強」。每寫一條守門就對它突變確認拿掉修法會紅;每寫一句註解、每一個數字都要能被程式碼支持(**上一個 change 就寫了一個沒數過的 `~5 steps`,實際是 8**)
- design.md 的殘餘風險 **(g) 修好之後要改寫**,不能留著說「目前沒有守門」;若修法有新的殘餘,誠實列出
