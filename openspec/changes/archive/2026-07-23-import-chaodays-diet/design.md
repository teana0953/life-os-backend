# Design — chaodays 匯入 Slice 2:飲食 + 血糖

## Why

「從 chaodays 匯入」的第二片,也是最重的一片:飲食紀錄 + 藏在飲食品項名稱裡的血糖文字。
沿用 Slice 1 打通的 chaodays connector(devise_token_auth、錯誤映射),擴充飲食端點與解析。

## chaodays 資料(已研究,見 memory chaodays-api-contract)

- `GET /users/diet_records?start_date=&end_date=` → `data:[{ date, record_type
  (breakfast|lunch|dinner|extra), recorded_at ("YYYY-MM-DD HH:mm"),
  staple/meat/fruit/veg/oil/sugar, diet_record_items:[{ name, staple/meat/fruit/veg/oil/sugar }] }]`。
- **血糖是自由文字**寫在 `diet_record_items[].name`,例:`"前血糖：93\n後血糖(1hr)：70"`、
  `"一根香蕉\n前血糖：70\n後血糖(2hr)：102"`、`"20克豌豆片"`(純食物)。

## 使用者決定(鎖定)

- **餐別對映**:`breakfast→早餐、lunch→午餐、dinner→晚餐、extra→點心`。
- **oil/sugar**:直接捨棄(lifeos 份量只有 staple/meat/fruit/veg 四軸)。
- **重複匯入**:已有就跳過該餐。

## Idempotency(同型多筆必須以「匯入前既有」為準)

chaodays 同一天可有**多筆同型 record**(尤其 extra→點心 常一日多筆)。「已存在」的判斷必須以
**匯入前既有**為準——不能用即時查詢,否則本次匯入剛建的第一筆會讓後續同型 record 被誤判成「已存在」
而靜默丟失食物。

- 每處理一個 `day` 前,先 `listMealsByDay(userId, day)` 取**匯入前既有餐別集合** `preexisting`(快照一次)。
- 該日某餐別在 `preexisting` 中 → **整個餐別跳過**(不動使用者既有那餐;計一次 mealsSkipped)。
- 不在 `preexisting` → 該日該餐別的**所有**同型 record 都 `upsertMealWithItems`(items append,
  故多筆同型自然合併進同一餐);mealsImported = 實際新建的餐數(每個 (day,meal) 一次)。

## 架構(沿用 Slice 1,擴充)

- **domain**:`ChaodaysClient` port 增 `fetchDietRecords(session, from, to): Promise<{ session,
  records: ChaodaysDietRecord[] }>`;型別 `ChaodaysDietRecord { date, recordType, recordedAt, items:
  ChaodaysDietItem[] }`、`ChaodaysDietItem { name, staple, meat, fruit, veg }`(丟 oil/sugar)。
- **血糖解析(domain 純函式)** `parseGlucoseReadings(itemName, time): GlucoseReading[]`:
  - `前血糖[：:]\s*(\d+)` → `{ label:"餐前", value, mealContext:"pre_meal", time }`
  - `後血糖(?:[（(](\d+)hr[）)])?[：:]\s*(\d+)` → `{ label:"餐後"(+"Nhr"), value, mealContext:"post_meal", time }`(可多筆 1hr/2hr)
  - `空腹血糖[：:]\s*(\d+)` 或含「空腹」的血糖 → `mealContext:"fasting"`
  - value 需為數字;`後血糖：`(無值)略過。time = 該筆 `recorded_at` 的 `HH:mm`。
- **食物名稱清洗** `stripGlucoseText(name): string`:移除血糖那幾行,回傳食物描述(trim)。
- **adapter** `HttpChaodaysClient.fetchDietRecords`:帶三 header、解析 envelope、輪替 session;
  200 但非 JSON/非陣列 → `ChaodaysUpstreamError`(同 Slice 1)。
- **use case** `import-chaodays-diet.ts`(注入 `MealRepository` + `VitalsRepository` + `ChaodaysClient`)
  `importChaodaysDiet(mealRepo, vitalsRepo, client, { userId, uid, password, from, to })`:
  1. signIn → fetchDietRecords。
  2. 依 day 分組;每日先取 `preexisting` 餐別快照(見上「Idempotency」)。逐筆 record(對映餐別):
     - **血糖**:每個 item.name 跑 `parseGlucoseReadings(name, recordedAtHHmm)` 收集該日 readings。
     - **食物 item**:`stripGlucoseText(name)` 清掉血糖文字後,**只在該 item 有份量
       (staple/meat/fruit/veg 任一 > 0)時**建 `CreateMealItem`(portions 分支,name = 清洗後名稱、
       空字串則 null;portions 有值故 unclassified:false 合規)。份量全 0 者(純血糖註記,或無份量的
       純文字)→ **不建 meal item**(血糖仍會被抽出)。避免建出 all-zero 份量的 item(與 meal-entry D1
       牴觸)。
     - **餐 idempotency**:餐別在 `preexisting` → 跳過(mealsSkipped++,只計一次);否則若該餐有 ≥1 個
       食物 item 才 `upsertMealWithItems({ userId, day, meal, time, items })`。同日同餐別的多筆同型
       record 都 append 進同一餐(不重複 skip)。
  3. **血糖寫入**(每日):read-modify-write vitals——`get` 既有 →
     `glucoseReadings: [...(existing?.glucoseReadings ?? []), ...新讀數去重]`;**去重鍵 =
     (time, value, mealContext, label)**(label 含 "Nhr" 標記,以免同時間、同值的餐後 1hr/2hr 被誤判重複),
     weight/bodyFat/bp/spo2 從 existing 帶回不清空 → `set`。glucoseImported 計實際新增數。
  4. 回 summary `{ mealsImported, mealsSkipped, glucoseImported, from, to }`。
- **route** `POST /api/import/chaodays/diet`(authMiddleware):body `{ chaodays_uid, chaodays_password,
  start_date, end_date }` → summary。驗證/錯誤映射沿用 Slice 1(缺欄位/日期非法→400;chaodays 帳密錯
  →400 `chaodays_auth_failed`;上游→502 `chaodays_unavailable`,onError 已有)。DI 在 index.ts/app.ts
  加新 use case wiring(client 已注入)。

## 安全

同 Slice 1:chaodays 密碼/session 只在請求中用完即丟、不儲存、不 log;錯誤 message 不夾帶憑證。

## 測試(Vitest)

- **glucose 解析 unit**(純函式):餐前/餐後(含 1hr/2hr 多筆)/空腹/混食物+血糖/無值略過/大小寫全形冒號。
- **食物清洗 unit**:純血糖→空、混合→只留食物、純食物→原樣。
- **use case unit**:`InMemoryMealRepository` + `InMemoryVitalsRepository` + `FakeChaodaysClient`:
  餐別對映、食物 item 份量正確、純血糖不建 item、**已有同餐跳過**、血糖 append 保留既有且去重、
  summary 計數、auth 失敗傳遞。
- **route integration**:`createApp` 全裝 + 真 token + stub client:200 summary、401、400(缺欄位/日期)、
  chaodays 帳密錯→400、上游→502。

## 範圍(明確排除)

純後端、只做飲食 + 血糖。不做飲水/排便(下一片)、不做前端 UI。gate = `npm test` + `npm run typecheck`。
