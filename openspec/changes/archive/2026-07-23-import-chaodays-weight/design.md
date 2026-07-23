# Design — chaodays 匯入 Slice 1:體重/體脂

## Why

「從 chaodays 匯入使用者資料」大功能的第一片。先用最單純的結構化資料(體重/體脂)
打通**跨服務認證 + 拉取 + 寫入 lifeos**的管線,de-risk 掉最難的 chaodays 認證,
後續 slice(飲食+血糖、飲水、排便)沿用同一條 connector。

## chaodays API(已研究,見 memory chaodays-api-contract)

- base `https://api.chaodays.app/api/v1/`,回應外層 `{ data, errors, message, pagination, status }`。
- 認證 = devise_token_auth:`POST /users/sign_in` body `{ user: { uid, password } }` → 成功時
  token 在**回應 header** `access-token` / `client` / `uid`。後續請求帶這三個 header;
  `access-token` 每次回應會輪替,要抓最新的給下一次。
- 體重:`GET /users/weight_records?start_date=&end_date=` → `data:[{ id, date, weight, body_fat_pct }]`。

## 架構(照 life-os-backend house style)

新元件都放在 **health context**(vitals 已在此),外部 client 走 DI port + fake 測試
(比照 `jwks` 的注入方式;專案目前無任何對外 fetch,這是第一個)。

- **domain port** `ChaodaysClient`(`src/contexts/health/domain/chaodays-client.ts`)
  - `signIn(uid, password): Promise<ChaodaysSession>` — session = `{ accessToken, client, uid }`。
  - `fetchWeightRecords(session, from, to): Promise<{ session, records: ChaodaysWeightRecord[] }>`
    —— 回傳**更新後的 session**(devise token 輪替),呼叫端拿新 session 給下一次。
    `ChaodaysWeightRecord = { date, weight, bodyFatPct | null }`。
  - 錯誤型別(domain):`ChaodaysAuthError`(sign_in 401 / 帳密錯)、`ChaodaysUpstreamError`
    (其他非 200 / 網路失敗)。
- **driven adapter** `HttpChaodaysClient`(`src/contexts/health/adapters/http-chaodays-client.ts`)
  - fetch-based;base URL 為常數(公開、非 secret)。sign_in 讀回應三 header;非 200 依 status
    丟 `ChaodaysAuthError`(401)或 `ChaodaysUpstreamError`。fetchWeightRecords 帶三 header、
    解析 envelope `data`、抓回應輪替後的 `access-token` 更新 session。
- **use case** `import-chaodays-weight.ts`
  `importChaodaysWeight(vitalsRepo, chaodaysClient, { userId, uid, password, from, to })`
  1. `session = await chaodaysClient.signIn(uid, password)`。
  2. `{ records } = await chaodaysClient.fetchWeightRecords(session, from, to)`。
  3. 每筆 record:`existing = await vitalsRepo.get(userId, date)` → `vitalsRepo.set({ userId, day:date,
     weightKg: weight, bodyFatPct: record.bodyFatPct ?? existing?.bodyFatPct ?? null,
     bpReadings: existing?.bpReadings ?? [], glucoseReadings: existing?.glucoseReadings ?? [],
     spo2Readings: existing?.spo2Readings ?? [] })`
     —— **read-modify-write**,只設 weight/bodyFat,保留既有血壓/血糖/血氧(照 `apply-exercise-bonus.ts`)。
     **bodyFat 缺值不覆寫**:chaodays 該筆 `body_fat_pct` 為 null 時保留該日既有手填的 bodyFatPct
     (weight 是體重記錄的主值,一律以 chaodays 為準)。
  4. 回 summary `{ imported, skipped, from, to }`(skipped = weight 為空的筆數)。

**分頁**:chaodays weight_records 分頁 `items` 為 10000/頁,單一使用者任何實際日期範圍都在一頁內
→ 只讀第一頁(`data`);設計上假設單頁,不做分頁迴圈(後續若有超大範圍需求再加)。

**不洩漏憑證**:`ChaodaysAuthError`/`ChaodaysUpstreamError` 的 message 為固定通用字串,
**不夾帶帳密/token**;client 不 log request/response;onError 的 500 fallback `console.error` 只會收到
這些不含憑證的錯誤(chaodays 呼叫失敗都已包成上述兩型)。
- **route** `POST /api/import/chaodays/weight`(authMiddleware)
  body(snake_case)`{ chaodays_uid, chaodays_password, start_date, end_date }` → resolveUserId →
  呼叫 use case → `c.json({ imported, skipped, from, to })`。
  驗證(BadRequestError→400):chaodays_uid / chaodays_password 必填非空、start_date/end_date 為
  合法 `YYYY-MM-DD` 且 from ≤ to。
- **錯誤映射**(`app.ts` onError,新增一條):`ChaodaysAuthError` → 400 `{ error:"chaodays_auth_failed" }`
  (使用者可修正的帳密錯);`ChaodaysUpstreamError` → **502** `{ error:"chaodays_unavailable" }`
  (上游問題,非 lifeos 內部錯,不落 500)。這兩型後續 slice 共用。

## 安全

- chaodays 密碼**只在該次請求記憶體中用來換 token,絕不儲存**(不進 DB、不記 log、不落 env)。
- session token triple 也不落地(一次性匯入用完即丟)。
- 無新增 env/secret:chaodays 帳密來自 request body,base URL 是常數。

## 測試(Vitest)

- **use case unit**(`test/contexts/health/application/`):`InMemoryVitalsRepository`(複用既有)+
  `FakeChaodaysClient`(可設定回傳 records、可設定 signIn 丟 `ChaodaysAuthError`)。
  驗:寫入正確 weight/bodyFat、**合併不清掉既有 readings**、skipped 計數、auth 失敗傳遞。
- **route integration**(`test/adapters/http/`):`createApp` 全裝 + 真 token(jose 本地簽)+
  fake ChaodaysClient stub。驗:200 summary、401(未帶 lifeos token)、400(缺欄位/日期非法)、
  chaodays 帳密錯 → 400 `chaodays_auth_failed`、上游失敗 → 502 `chaodays_unavailable`。

## 範圍(明確排除)

純後端、只做體重/體脂。不做飲食/血糖/飲水/排便(後續 slice)、不做前端 UI。
gate = `npm test` + `npm run typecheck`。
