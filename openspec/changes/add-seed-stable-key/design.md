# 設計:seed 用穩定 key 去重,不再用可變的 name

來源:PR #59(`add-admin-shared-food-editing`)的 review follow-up —— seed 以 `name` 判斷「這列已經有了」,但同一個 PR 讓 admin 改得動共用品項的 `name`。admin 把 `飯/1碗` 改成 `白飯/1碗` 之後,下次 `npm run db:seed` 找不到原名,就把原始 seed 列**重新插一遍**,字典裡同時留著改名後那列與復活的舊列。這直接違反該 change 自己寫進 spec 的 scenario「Re-running the seed keeps administrator changes … and no shared item is duplicated」。

## 兩軸判定

- `flow_profile`: **full** — 行為變更 + DB migration。
- `needs_uiux`: **false** — 純後端,不動畫面。

## 現況

- `seedFoodDictionary`(food-dictionary-seed.ts:129-131)讀既有共用列的 `name` 組成 Set,再 `rows.filter((row) => !existingNames.has(row.name))`。
- `name` 從 PR #59 起是 admin 可 PATCH 的欄位(admin-food-dictionary.ts 的可改欄位清單)。
- **共用**只由 `owner_user_id IS NULL` 定義,seed 建的列與 admin 建的共用列目前無法區分。
- 線上資料(2026-07-30 實查):共用列 271 筆,與 `SEED_ROWS` 的 271 列**名稱一對一完全吻合** —— 沒有 admin 手建的共用列,也沒有漏掉的 seed 列。

## 決策

### D1 — 加 `food_item.seed_key`(nullable text)

seed 插入的列寫入 `seed_key`;admin 手建的共用列與使用者自訂列都是 null。判斷「這列已經有了」改為比對 `seed_key`,`name` 之後怎麼改都不影響。

### D2 — key 的值 = seed 檔那一列的 `name`

seed 檔的列本來就以名稱識別食物(來源是使用者的 Google Sheet),沒有另一個天然 id;用列的順序當 key 會在重排時全錯位。所以 `seed_key = 該 seed row 原始的 name`,**寫入後就不再跟著 `food_item.name` 走**。

已知取捨:若日後**seed 檔本身**把某列改名,那會被當成一列新食物補進來(舊列仍在,name 已可能被 admin 改過)。這是刷新 seed 檔時的人工判斷,不在自動路徑處理;`--force` 全量重灌仍可用。

### D3 — migration + backfill

`ALTER TABLE food_item ADD COLUMN seed_key text;` 加上 backfill
`UPDATE food_item SET seed_key = name WHERE owner_user_id IS NULL;`。

backfill 之所以成立:上面「現況」查證過線上 271 筆共用列全部來自 seed、名稱與 seed 檔一對一,且此刻**尚無任何列被改過名**(admin 編輯功能昨天才上線)。等有人改過名再 backfill 就不成立了,所以這輪要一起上。

drizzle-kit 產出的 SQL **只會有 ADD COLUMN**,backfill 那行要手動補進同一個 migration 檔(既有 `0014`/`0016` 已有手寫 backfill 的先例)。

### D4 — 部分唯一索引

`CREATE UNIQUE INDEX ... ON food_item (seed_key) WHERE seed_key IS NOT NULL;` —— 讓「同一個 seed 列不可能出現兩次」由資料庫保證,而不是只靠應用層的 filter。null 不受限,admin 建的共用列與自訂列不受影響。

### D5 — seed 寫入與比對都改用 seed_key

- `seedFoodDictionary` 讀 `seed_key`(仍限 `owner_user_id IS NULL`)組 Set,以 `row.name` 對 `seed_key` 比對,插入時寫 `seedKey: row.name`。
- `--force` 路徑(先刪光共用列再整批插)同樣寫 `seed_key`。
- 回傳的 `{ inserted, skipped }` 語意不變。

### D6 — `seed_key` 不可經 API 編輯

`seed_key` 不加進 PATCH 的可改欄位清單,也不出現在 `POST /api/admin/food-items` 的 payload —— admin 建的共用列一律 null。它是 seed 的內部識別,不是使用者資料。

### D7 — 不列入 API 回應

`toJson`(routes/food-dictionary.ts)不加這個欄位:前端沒有任何用途,列進去只會變成得維護的公開契約。

## 不做

- 不處理「admin 手建的共用列剛好與日後新增的 seed 列同名」——那會是兩列同名共用品項。極邊界,且 D4 的唯一索引管不到(一邊是 null)。
- 不改 `--force` 的破壞性語意。
- 不補 seed 檔改名時的自動搬移。

## 驗收

1. seed 跑過一次後改掉某共用列的 `name`,再跑一次 seed:**不會**新增任何列,`inserted` 為 0。
2. 空資料庫跑 seed:271 列全插入,每列 `seed_key` 等於其 seed 名稱。
3. seed 跑第二次(沒人改名):`inserted` 0、`skipped` 271。
4. admin 建的共用列 `seed_key` 為 null,且跑 seed 不會動到它。
5. 使用者自訂列(owner 非 null)`seed_key` 為 null,不參與比對。
6. `seed_key` 不出現在任何 API 回應,也無法經 PATCH/POST 設定。
