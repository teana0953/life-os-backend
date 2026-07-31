# Finance Ledger(後端)— 設計

來源:總設計 spec 已由使用者核准(`life-os/docs/superpowers/specs/2026-07-31-finance-ledger-design.md`)。本檔為其後端切片,前端另起 life-os repo 的 loop。

## 目標

個人記帳核心的後端:交易 CRUD、分類管理(含預設種子)、月統計 summary。全部 user 隔離,沿用 Firebase token auth。

## 範圍外

預算、淨值、分帳(群組/好友/跨使用者)、推播、匯率換算、子分類。schema 不預建這些表。

## 資料模型(Neon Postgres + Drizzle,`src/shared/db/schema.ts`)

照 repo 既有慣例:`pgTable`、`uuid("id").primaryKey().defaultRandom()`、`uuid("user_id").references(() => users.id)`、`boolean`、`timestamp(..., { withTimezone: true }).defaultNow()`、day 用 `date("day")` 欄型(同 `mealEntry.day`)。

### `finance_category`

- `id` uuid pk defaultRandom
- `user_id` uuid not null → `users.id`
- `name` text not null
- `type` text not null(`expense` | `income`)
- `icon` text not null default `'other'`(短識別字串,前端映射)
- `sort_order` integer not null default 0
- `archived` boolean not null default false
- `created_at` / `updated_at` timestamptz not null defaultNow
- **unique index `(user_id, type, name)`**:lazy 種子併發兜底(見下)

### `finance_transaction`

- `id` uuid pk defaultRandom
- `user_id` uuid not null → `users.id`
- `type` text not null(`expense` | `income`)
- `amount` integer not null(最小幣別單位:TWD 存元、USD 存 cent;必須 > 0)
- `currency` text not null(ISO 4217,白名單驗證;create 未帶時預設 `'TWD'`)
- `category_id` uuid not null → `finance_category.id`
- `day` date not null(`YYYY-MM-DD`,同 `mealEntry.day` 慣例;API 欄名 `date`)
- `note` text nullable
- `created_at` / `updated_at` timestamptz not null defaultNow

索引:`finance_transaction (user_id, day)`。

Migration:`npm run db:generate` 產生,照現有 drizzle 流程。

### 預設分類種子(lazy,per-user)

首次呼叫 `GET /api/finance/categories` 時若該 user 無任何分類(含 archived),種入預設:

- expense:餐飲/交通/購物/娛樂/居住/醫療/其他(sort_order 0–6)
- income:薪資/獎金/利息/其他(sort_order 0–3)

種子在 application 層(`ensureDefaultCategories`),不是 db:seed script——分類是 per-user 資料,不是全域字典。冪等:插入用 `onConflictDoNothing`(靠 `(user_id, type, name)` unique index),併發下也不會種兩份。

## API(掛在 `src/adapters/http/app.ts` 的 `createApp`,auth middleware 後;`src/index.ts` 只做 DI)

```
GET    /api/finance/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD   (from/to 皆必填)
POST   /api/finance/transactions        { type, amount, currency?, category_id, date, note? }
PUT    /api/finance/transactions/:id    { type, amount, currency, category_id, date, note? }
DELETE /api/finance/transactions/:id
GET    /api/finance/categories          (觸發 lazy 種子)
POST   /api/finance/categories          { name, type, icon?, sort_order? }
PUT    /api/finance/categories/:id      { name?, icon?, sort_order?, archived? }(type 不可改)
GET    /api/finance/summary?month=YYYY-MM
```

### 驗證規則

- `amount`:正整數(>0);`type`:enum;`date`:`requireDay`(validation.ts);`month`:`requireMonth`(validation.ts)
- `currency`:白名單 `TWD/USD/JPY/EUR/CNY/KRW/GBP/HKD/AUD/CAD`,大寫。**POST 未帶預設 `TWD`;PUT 是整筆替換語意,`currency` 必填**——不給預設,避免省略時把 USD 交易靜默改成 TWD。
- `category_id`:必須存在、屬同 user、`type` 相符(expense 交易配 expense 分類)。archived 檢查:**create 恆擋 archived 分類;update 僅當 `category_id` 有變更時擋 archived**(換到 archived 分類 → 400);`category_id` 未變時不驗 archived,讓歷史交易(其分類已 archived)仍可改 note/amount/date,不鎖死編輯。
- 交易的 `:id` 不存在或屬他人 → 404(不洩漏存在性);他人的 `category_id` → 404。
- 分類刪除:無 DELETE endpoint,只有 `archived` 軟刪;既有交易讀取不受影響。
- 分類名重複(同 user 同 type):create/update 先查再寫,回 400——不讓 `(user_id, type, name)` unique violation 直穿變 500。
- `updated_at`:`defaultNow` 只在 insert 生效,repository 的 update 一律顯式 `set({ updatedAt: new Date() })`。

### `GET /api/finance/summary` 回應形狀

```json
{
  "month": "2026-07",
  "totals": [
    { "currency": "TWD", "expense": 12345, "income": 50000, "net": 37655 }
  ],
  "by_category": [
    { "category_id": "…uuid…", "type": "expense", "currency": "TWD", "amount": 3200 }
  ]
}
```

- 按幣別分列,不換算(核准決策)
- SQL 彙總(group by),不撈整月明細到記憶體逐筆加
- 注意:pg 的 `SUM(integer)` 回 bigint(字串),adapter 要 cast 成 number 再回傳

## 架構落點(照現有 context 模式)

新 context `src/contexts/finance/`:

- `domain/`:`FinanceCategory`、`FinanceTransaction` 實體;port 照 health context「一 aggregate 一 port」慣例拆兩個——`FinanceCategoryRepository`、`FinanceTransactionRepository`;typed errors(`FinanceCategoryNotFound`、`FinanceCategoryArchived`、`FinanceCategoryTypeMismatch`、`FinanceTransactionNotFound`)
- `application/`:`ensureDefaultCategories`、`listTransactions`、`createTransaction`、`updateTransaction`、`deleteTransaction`、`listCategories`、`createCategory`、`updateCategory`、`getMonthlySummary`
- `adapters/`:Drizzle repository 實作(含 summary 的 group by 查詢與 bigint cast)
- HTTP:`src/adapters/http/routes/finance.ts`,handler factory 模式(照 water.ts);`app.ts` `createApp` 掛路由,`index.ts` 建 repository 注入

## 錯誤處理

- 驗證失敗 → 400(現有 `requireX` helpers 慣例)
- 404 統一 `{ "error": "not_found" }`(repo 現有慣例):交易/分類不存在或非本人
- typed errors 由 route 層映射 HTTP status,照現有 error boundary 慣例

## 測試(重要邏輯必須覆蓋;TDD 依需求)

vitest,照現有兩層測試模式(unit:use case + in-memory fake repository;workers:HTTP route 注入 fake):

- 交易 CRUD happy path + 驗證失敗(amount ≤0、幣別不在白名單、date 格式錯、PUT 缺 currency)
- user 隔離:A 建的交易/分類,B 讀不到、改不動、刪不掉(404)
- 分類:lazy 種子冪等(呼叫兩次不重複種)、type 不符掛單 400、archived 分類掛新交易 400、archived 後既有交易仍可讀且可改(category_id 不變時)、換到 archived 分類 400
- summary:跨幣別分列正確、expense/income/net 正確、空月份回空陣列、只含該 user 資料
- **誠實聲明**:unit 層用 fake repository,驗的是彙總「邏輯」;真 SQL group by 與 bigint cast 在 Drizzle adapter,route 測試也注入 fake——SQL 本身靠 typecheck + drizzle 型別把關,不假稱測試涵蓋了真 DB 查詢

## 驗收

- 全 gate 綠:`npm test`、`npm run typecheck`
- summary 數字與手算一致(測試斷言)
