## Why

life-os#90「[照護管理] 編輯的方式」要求編輯一筆照護紀錄時**也能指定完成時間**——
補登昨晚忘了按的藥時,能記下「其實是 21:30 吃的」,而不是被記成「按下編輯的那一刻」。

目前 `editCareSlot`(`PUT /api/care/log`)把 `doneTime` 寫死成 `new Date()`
(伺服器當下),呼叫端無從指定,所以前端做不出這個功能。

## What Changes

- **`EditCareSlotInput` 新增可選的 `doneTime?: Date`**,語意是
  **「未指定 = 不要動這個欄位」,而不是「重設成現在」**:

  | status | 帶 `doneTime` | 既有 log | 寫入的 `doneTime` |
  |---|---|---|---|
  | `skipped` | 任意 | 任意 | `null`(略過從未完成) |
  | `done` | 有 | 任意 | 帶入值 |
  | `done` | 無 | 既有已是 `done` **且有值** | **保留既有值** |
  | `done` | 無 | 既有已是 `done` 但值為 `null` | `new Date()`(沒有東西可保留) |
  | `done` | 無 | 無 log / 既有非 `done` | `new Date()`(這一刻才首次完成) |

  第二列的 `null` sub-case 是 code review 抓到的:只看 status 會把舊資料列的 `null`
  「保留」下來,寫回 `status: done` + `doneTime: null` —— 正是這個分支要防的形狀。
  現行寫入者產不出這種列(`answerCareSlot` 一定戳時間、`run-care-tick` 只寫 `missed`+`null`),
  所以這是給 legacy/匯入資料的防護。

  **「保留既有值」是這次必須加的**(proposal-review 抓到):
  `DrizzleCareLogRepository.upsert` 的 `onConflictDoUpdate` **無條件** `set doneTime`,
  所以在補登了「21:30」之後,任何一次不帶 `done_time` 的編輯都會把它靜默洗成當下 ——
  改動前無所謂(值本來就都是當下),改動後是可見的資料遺失。不靠「呼叫端記得每次回送」
  的約定來避免,因為忘了帶的代價是無聲的。
  - 實作:只在 **`status === "done"` 且未帶 `doneTime`** 時,用**既有的**
    `careLogRepo.getBySlot(...)` 多讀一次(其餘情況零額外查詢);**不改** repository
    介面,`upsert` 的回傳維持 `{ log, previousStatus }`。
  - **已知重複查詢(接受)**:`DrizzleCareLogRepository.upsert` 在寫入前**已經**
    SELECT 過同一把 slot key(為了 `previousStatus`),所以「done + 未帶」這條路徑會對
    Neon 發**兩次相同的 SELECT** —— 而那正是既有前端呼叫端的預設路徑。**接受**:
    單筆編輯多一次 round-trip,對 Workers 的 subrequest 上限無實質影響,換到的是
    不動 `CareLogRepository` port、不動所有既有 fakes。
    (更省的做法是 `editCareSlot` 開頭無條件讀一次、用同一筆同時決定 `doneTime` 與
    `previousStatus`,`upsert` 拿掉內部 pre-select —— 讀取次數與現況相同,但要改 port
    與每個 fake,留待真的需要時再做。)
  - **「讓 `upsert` 回傳 `previousDoneTime`」不可行**,別當成被錯過的更簡解:那個值
    要等該列**被覆寫之後**才拿得到,救不了這裡要防的資料遺失。
  - **`status: "skipped"` 時忽略 `doneTime`**(仍寫 `null`)——`doneTime` 只在「完成」
    才有意義,帶了也不當錯誤(對前端較寬容:使用者把「完成 + 21:30」改成「略過」時,
    前端不必先清掉時間欄位)。
- **route `PUT /api/care/log` 收 `done_time`**:用既有的
  `optionalTimestamp(body.done_time, "done_time")`(`undefined`/`null` → `undefined`;
  非字串或無效時間 → 400)。**時區責任在呼叫端,且 `done_time` 必須帶時區偏移**
  (`Z` 或 `±hh:mm`):`optionalTimestamp` 只檢查 `new Date(v)` 非 `NaN`,所以
  `"2026-07-27T21:30:00"` 這種無偏移字串在 Workers(UTC runtime)會被當成 UTC 而靜默
  偏移;回應經 `careLogToJson` 一律正規化成 UTC ISO。前端把使用者選的本地時間轉成
  帶偏移的 ISO 再送。
- **不動** `POST /api/care/log`(`answerCareSlot`):那是「當下按下」的首次記錄,
  當下時間就是正確答案,沒有指定的需求(YAGNI)。
- **不做**「只有今日可編輯」的伺服器端限制:那是 issue 的 UI 決策(前端只在今日照護
  的已完成區提供編輯入口、紀錄頁過去的變唯讀),不是安全邊界——編輯過去紀錄本來就是
  這個端點的用途,後端保持寬鬆。

## Impact

- Affected specs: `care-reminders`(MODIFIED:「Edit a past care record」requirement)
- Affected code: `src/contexts/notifications/application/edit-care-slot.ts`、
  `src/adapters/http/routes/care.ts`
- **無 migration**:`care_log.done_time` 欄位早已存在,只是改由誰決定它的值。
- 既有呼叫端(前端 `/care-history` 的編輯)不帶 `done_time`,**唯一的行為改變是
  「不再刷新已記錄的完成時間」**(四列表第三列)——把一個已經是 `done` 的格子再存一次
  `done`,改動前會把完成時間刷成當下,改動後保留既有值。那正是這次要的修正,但別把它
  當成「零變更」而低估回歸面。
