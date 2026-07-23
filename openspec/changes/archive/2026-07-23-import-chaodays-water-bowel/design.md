# Design — chaodays 匯入 Slice 3:飲水 + 排便

## Why

「從 chaodays 匯入」第三片,最單純的結構化資料(飲水、排便)。沿用 Slice 1/2 的 connector。
後端匯入到此完整(飲食/血糖/體重/體脂/飲水/排便六類皆可匯),Slice 4 做前端 UI。

## chaodays 資料(已研究,見 memory chaodays-api-contract)

- `GET /users/water_records?start_date=&end_date=` → `data:[{ date, water(ml), recorded_at }]`
  —— **每日多筆**(每次喝水一筆)。
- `GET /users/defecation_records?start_date=&end_date=` → `data:[{ date, defecation(次數),
  is_abnormality(bool), note }]` —— 每日約一筆(可能多筆)。

## 使用者決定(沿用飲食「已有就跳過」)

- **重複匯入**:已有就跳過該日(避免蓋掉使用者在 lifeos 直接輸入的、且天然 idempotent)。

## 架構(沿用 Slice 1/2)

- **domain**:`ChaodaysClient` port 增 `fetchWaterRecords` / `fetchDefecationRecords`
  (簽章同 `(session, from, to) → { session, records }`);型別
  `ChaodaysWaterRecord { date, waterMl, recordedAt }`、
  `ChaodaysDefecationRecord { date, count, isAbnormality, note }`。
- **adapter** `HttpChaodaysClient`:照 `fetchWeightRecords` 模式加兩個方法——三 header、
  envelope `data` 解析、輪替 session、200 非 JSON/非陣列 → `ChaodaysUpstreamError`;
  raw `{date, water, recorded_at}` / `{date, defecation, is_abnormality, note}` → camelCase。

### 飲水 use case `import-chaodays-water.ts`(WaterRepository + ChaodaysClient)

`importChaodaysWater(waterRepo, client, { userId, uid, password, from, to })`:
1. signIn → fetchWaterRecords。
2. 依 day 分組,每日 **加總 waterMl**;加總 **≤ 0 的日直接略過**(不建空 intake 列、不計數)。
3. 每日(總量 > 0):`getIntake(userId, day)` — 若已有紀錄(非 null)→ 跳過(skipped++,不 clobber);
   否則 `addIntake(userId, day, 該日總量)`(imported++)。
   —— WaterRepository 無「設定總量」method 且 `addIntake` 累加,故用「已有就跳過」達成 idempotency。
4. 回 summary `{ imported, skipped, from, to }`(以「日」計)。

### 排便 use case `import-chaodays-bowel.ts`(BowelRepository + ChaodaysClient)

`importChaodaysBowel(bowelRepo, client, { userId, uid, password, from, to })`:
1. signIn → fetchDefecationRecords。
2. 依 day 分組並**聚合**:`count = Σ record.count`、`isNormal = !任一 record.isAbnormality`
   (**注意語意取反**:chaodays 記異常、lifeos 記正常;任一異常則當日 isNormal=false,
   全無異常則 true)、`note = 各筆非空 note 以換行合併`。
3. 每日:`get(userId, day)` — 若已有 bowel log(非 null)→ 跳過(skipped++,不 clobber);
   否則 `set({ userId, day, count, isNormal, note })`(imported++)。
   —— `set` 雖是整日 upsert(天然 idempotent),仍「已有就跳過」以免蓋掉使用者手輸。
4. 回 summary `{ imported, skipped, from, to }`。

- **route**(authMiddleware,照 `import-chaodays.ts` 模板):
  `POST /api/import/chaodays/water`、`POST /api/import/chaodays/bowel`,body
  `{ chaodays_uid, chaodays_password, start_date, end_date }` → summary。驗證/錯誤映射沿用
  (缺欄位/日期→400;帳密錯→400 `chaodays_auth_failed`;上游→502 `chaodays_unavailable`,onError 已有)。
  `app.ts` 註冊兩條 + wiring(waterRepository/bowelRepository/chaodaysClient 都已在 CreateAppOptions)。

## 安全

同前:chaodays 密碼/session 只在請求中用完即丟、不儲存、不 log;錯誤 message 不夾憑證。

## 測試(Vitest)

- **飲水 use case unit**(`InMemoryWaterRepository`(累加語意)+ `FakeChaodaysClient`):同日多筆加總、
  已有跳過、summary 計數、auth 傳遞、params 穿線。
- **排便 use case unit**(`InMemoryBowelRepository` + fake):count 加總、**isNormal 取反聚合**(任一異常)、
  note 合併、已有跳過、summary、auth 傳遞。
- **adapter unit**:兩個 fetch 方法——三 header、envelope、輪替 session、非 JSON/非陣列/malformed → Upstream。
- **route integration**(兩條):200 summary、401、400(缺欄位/日期)、帳密錯→400、上游→502。

## 範圍(明確排除)

純後端、只做飲水 + 排便。不做前端 UI(Slice 4)。gate = `npm test` + `npm run typecheck`。
