## 1. application:可指定完成時間

- [x] 1.1 (red) `test/contexts/notifications/application/edit-care-slot.test.ts`
      (既有 `describe("editCareSlot")` 在該檔):四條語意各一測 ——
      (a) `status: "done"` + 帶 `doneTime` → log 的 `doneTime` 等於帶入值(不是當下);
      (b) `status: "done"` + 未帶 + **既有 log 已是 done** → **保留既有 `doneTime`**
      (這是防資料遺失的那條,fake repo 要能回既有 log);
      (c) `status: "done"` + 未帶 + 無 log / 既有非 done → 當下(行為不變);
      (d) `status: "skipped"` + 帶 `doneTime` → log 的 `doneTime` 為 `null`(忽略,不報錯)。
      另驗庫存 delta 行為不受影響,且 (a)/(d) **不會**多打一次 `getBySlot` ——
      既有的 `FakeCareLogRepository`(該檔 :86 一帶)只回資料、沒有呼叫計數,
      要**加一個 `getBySlotCalls` 計數器**才斷言得了(其餘 `seed`/`getBySlot` 已具備)。
- [x] 1.2 (green) `EditCareSlotInput` 加可選 `doneTime?: Date`;`editCareSlot` 依
      proposal 的四列表格決定寫入值,只在「done 且未帶」時呼叫既有的
      `careLogRepo.getBySlot(...)`;**不改** `CareLogRepository` 介面。更新 doc comment
      說明「未指定 = 不要動這個欄位」的語意與其理由(upsert 無條件覆寫 doneTime)。

## 2. HTTP:收 done_time

- [x] 2.1 (red) `test/adapters/http/care.test.ts` 的既有 `describe("PUT /api/care/log")` 區塊:
      `PUT /api/care/log` 帶**有時區偏移**的 `done_time`(例 `2026-07-20T21:30:00+08:00`)
      → 回應的 `done_time` 是**正規化後的 UTC**(`2026-07-20T13:30:00.000Z`),**不是**
      原字串(`careLogToJson` 一律 `toISOString()`);等價寫法是比較
      `new Date(res.done_time).getTime()` 為同一瞬間 —— 這條才釘得住 spec 的
      「completion time is an absolute instant」scenario;
      未帶 → 仍有 `done_time`(當下);`status: "skipped"` 帶 `done_time` → 回應
      `done_time` 為 `null` 且**非** 400;`done_time` 為非字串或無效時間 → 400。
- [x] 2.2 (green) `createEditCareSlotHandler` 用既有的
      `optionalTimestamp(body.done_time, "done_time")` 填 `input.doneTime`。

## 3. gate

- [x] 3.1 `npm test` + `npm run typecheck` 全綠。
