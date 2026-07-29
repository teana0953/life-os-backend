# 設計:食物字典 admin 可自由編輯(後端)

來源:[life-os#87](https://github.com/teana0953/life-os/issues/87)「[食物字典] admin 可以自由編輯」(issue body 為空,需求由與使用者確認得出)。

## 需求(已與使用者確認)

- admin 身分判定:`users.is_admin` 布林欄位。
- admin 能力範圍:**編輯共用品項欄位** + **新增共用品項**。不含刪除、不含編輯其他使用者的自訂品項。
- 前端 UI(食物搜尋頁內嵌編輯入口)**不在本輪範圍**,另起一輪 `life-os` repo 的 loop。
- 本輪 repo 範圍:`life-os-backend`。

## 兩軸判定

- `flow_profile`: **full** — 行為變更(新 API + 新授權概念 + DB migration)。
- `needs_uiux`: **false** — 純後端 API,本輪不動任何畫面。

## 現況

- `food_item.owner_user_id`:null = 共用(seeded)品項,所有人可見;非 null = 該使用者私有自訂品項。
- 既有路由只有 search / create custom / favorite / unfavorite / list favorites。**沒有任何 update 路徑**。
- 全 repo **零 admin/role 概念**(`grep -ni "admin|role" src` 無命中);`users` 表只有 firebase_uid/email/display_name/timezone/created_at。
- `meal_item` 自帶 `nutrientColumns` + `portionColumns` + `base_amount`/`measure_unit`(schema.ts:81-97),即**餐點記錄是寫入當下的快照**,不從 `food_item` 即時讀取。

## 決策

### D1 — admin 判定:`users.is_admin` boolean

`users` 加 `is_admin boolean NOT NULL DEFAULT false`,drizzle migration 產生。開通 admin 走手動 SQL(本輪不做管理介面)。

取捨:相對 Worker env 允許清單,改人不用重新 deploy、可測(fake repo 直接給 true/false);相對 role enum,現在只有一種特權角色,布林足夠,要擴充時再 migrate。

### D2 — 領域模型:`User.isAdmin`

`User` 介面加 `isAdmin: boolean`;`DrizzleUserRepository` 的 `toDomain` 帶出。`getOrCreate` 語意不變(新建者 default false,既有列不刷新)。

### D3 — 授權點:`resolveAdminUser`

現有 `resolveUserId(userRepository, claims)` 只回 id。新增 `resolveAdminUser(userRepository, claims)`:get-or-create 後檢查 `isAdmin`,false 則丟一個可被 handler 轉成 403 的錯誤(或直接回 `User | null`,由 handler 回 403)。實作採**回 `User | null`**,handler 判 null → `c.json({ error: "forbidden" }, 403)`,不引入例外流。

未帶/無效 token 仍由既有 `authMiddleware` 擋為 401 — admin 檢查只負責 403 這層。

### D4 — 路由形狀:`/api/admin/food-items`

- `POST /api/admin/food-items` — 建立**共用**品項(`owner_user_id = null`),回 201。
- `PATCH /api/admin/food-items/:id` — 編輯共用品項,回 200 + 更新後的品項。

用 `/api/admin` 前綴而非在既有 `POST /api/food-items` 加旗標:使用者路徑與 admin 路徑語意分離,權限判斷落在路由層,handler 不必混判「這次是要建自訂還是共用」。既有 `POST /api/food-items`(建自訂品項)行為完全不動。

### D5 — PATCH 的目標限制

只能改共用品項(`owner_user_id IS NULL`)。找不到該 id、或該 id 是**某使用者的自訂品項** → 一律 404(不區分,不洩漏私有品項是否存在)。

### D6 — PATCH 語意:部分更新,「缺鍵」與「明確 null」不同

只有 request body 中出現的欄位才更新;可改:`name`、`carb_g`、`protein_g`、`fat_g`、`sugar_g`、`fiber_g`、`kcal`、`staple`、`meat`、`fruit`、`veg`、`base_amount`、`measure_unit`。`id`/`owner_user_id`/`created_at` 不可改(出現在 body 中直接忽略)。空 body(無任何可改欄位)→ 400。

**缺鍵 = 不動,明確 `null` = 清空**(只有 measure basis 兩欄可被清空;其餘欄位送 null 視為型別錯誤 → 400)。既有的 `optionalFiniteNumber` / `optionalFiniteNumberOrUndefined`(validation.ts:38,44)把 `null` 與「缺鍵」壓成同一件事,**不能**用來表達這個語意;`routes/care.ts:44,51` 已有正確形狀的 `nullableString`/`nullableNumber`,但目前是該檔私有。做法:把這兩個 helper 移進 `src/adapters/http/validation.ts` 匯出、`care.ts` 改為 import(純搬移,行為不變),PATCH handler 以 `"key" in body` 判斷是否有送該鍵,再用 nullable helper 驗值。

### D7 — measure basis 不變式

既有 spec 要求 `base_amount` 與 `measure_unit` **同時有值或同時為 null**。PATCH 以**套用後的最終狀態**檢驗(例如原本兩者皆有值、只送 `measure_unit: null` 而未送 `base_amount` → 違反 → 400);POST 共用品項同樣檢驗。違反回 400。

### D8 — POST 共用品項的 payload

與現有 `POST /api/food-items` 相同(name + 六項營養素必填、四項份數選填 default 0),額外接受選填的 `base_amount` + `measure_unit`(受 D7 不變式約束)。回應 JSON 形狀沿用既有 `toJson`。

### D9 — repository port 擴充

`FoodDictionaryRepository` 加三個方法:

- `findSharedById(id): Promise<FoodItem | null>` — 只找 `owner_user_id IS NULL` 的品項。
- `createShared(input): Promise<FoodItem>` — 建立 `owner_user_id = null` 的品項(含選填 measure basis)。
- `updateSharedById(id, patch): Promise<FoodItem | null>` — 部分更新,回更新後品項;目標不存在或非共用回 null。

現有 `search`/`findById`/`createCustom`/favorite 系列不動(共用品項本來就對所有人可見,搜尋語意不變)。

### D10 — 編輯不改寫歷史

`meal_item` 是寫入當下的營養/份數快照(見「現況」),所以 admin 修正字典品項**不會**回溯改變既有餐點記錄的熱量與份數。這是預期行為,寫進 spec 當可驗 scenario,避免日後誤以為是 bug。

### D11 — seed 不再清空共用品項

`npm run db:seed`(`src/contexts/health/adapters/seed/run-seed.ts:35`)現在是 `delete where owner_user_id IS NULL` 再整批插入。這與本功能直接衝突:任何 admin 的修正與新增的共用品項會被整批抹掉,連帶 `food_favorite` 因 `onDelete: cascade`(schema.ts:58)一起消失。

改為**只插入名稱尚不存在的共用品項**(以既有共用列的 `name` 比對;`SEED_ROWS` 內部無重複名稱),既有共用列一律不動;舊的破壞性行為保留在明確的 `--force` 旗標下(`npm run db:seed -- --force`),供在可丟棄的資料庫上刷新 seed 檔用。

跳過邏輯放在 `seedFoodDictionary(db, rows)`(food-dictionary-seed.ts:116)而不是 `run-seed.ts`:後者在模組頂層就執行 `main()`(run-seed.ts:40),會連真的資料庫並 `process.exit`,測試無法 import。`run-seed.ts` 只留薄薄的 `--force` 判斷。

取捨:refresh seed 檔後,既有列不會自動跟著更新(要嘛 `--force`,要嘛由 admin 從 API 修正)。這正是本功能存在的理由,可接受。

### D12 — `GET /api/me` 回傳 `is_admin`

前端(另一輪)要決定是否顯示編輯入口,若不回傳就只能靠打 API 吃 403 來試探。`routes/me.ts:21-27` 是逐欄序列化,加一個 `is_admin: user.isAdmin` 即可。這連帶要改 `user-account` 既有的「Current-user endpoint」需求(MODIFIED delta)。

### D13 — 非 UUID 的 `:id`

`food_item.id` 是 uuid 欄位,把非 UUID 字串丟進 `where` 會讓 Postgres 以 22P02 錯誤炸開 → 現行 `onError` 會轉成 500。admin 端點在查詢前先檢查 `:id` 是否為 UUID 格式,不是就當 404(與「不存在」同一個出口,也不洩漏格式資訊)。

## 不做(明確排除)

- 刪除共用品項(要處理 `meal_item.food_item_id` 的 `set null` 影響與 UX,範圍另計)。
- 編輯其他使用者的自訂品項。
- admin 開通介面 / 使用者管理。
- 前端編輯 UI(另一輪)。
- 稽核記錄(誰改了什麼)。

## 驗收(對應 openspec spec scenario)

1. 非 admin 呼叫兩個 admin 端點 → 403,品項未變。
2. 未帶 token → 401(既有中介層)。
3. admin PATCH 共用品項的部分欄位 → 200,只有送出的欄位改變,其餘不動。
4. admin PATCH 某使用者的自訂品項 id → 404,該品項未變。
5. admin PATCH 不存在的 id → 404。
6. PATCH 造成 `base_amount`/`measure_unit` 一有一無 → 400,品項未變。
7. admin POST 共用品項 → 201,`owner_user_id` 為 null,且**其他使用者**搜尋得到。
8. 既有餐點記錄在其引用的字典品項被編輯後,營養與份數不變。
