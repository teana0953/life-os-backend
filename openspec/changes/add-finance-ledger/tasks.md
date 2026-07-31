# Tasks

## 1. Schema 與 migration

- [x] 1.1 `src/shared/db/schema.ts` 加 `finance_category`、`finance_transaction` 兩表(pgTable/uuid/timestamptz/date 慣例,欄位/索引/unique 照 design.md),`npm run db:generate` 產 migration,`npm run typecheck` 過。

## 2. Domain + application(重要邏輯,測試必須覆蓋;unit 層 fake repository)

- [x] 2.1 `src/contexts/finance/domain/`:實體型別、兩個 port(`FinanceCategoryRepository`、`FinanceTransactionRepository`,照 health「一 aggregate 一 port」慣例)、typed errors(`FinanceCategoryNotFound` / `FinanceCategoryArchived` / `FinanceCategoryTypeMismatch` / `FinanceTransactionNotFound`)。
- [x] 2.2 `application/ensure-default-categories.ts`:user 無任何分類(含 archived)時種預設(expense 餐飲/交通/購物/娛樂/居住/醫療/其他 sort_order 0–6;income 薪資/獎金/利息/其他 0–3),`onConflictDoNothing` 冪等。測試:呼叫兩次不重複。
- [ ] 2.3 `application/` 交易 use cases:create/update/delete/list(from/to range,皆必填)。驗證:amount 正整數;category 屬同 user、type 相符;archived 檢查照 design.md 規則(create 恆擋;update 僅 category_id 變更時擋);他人/不存在 → NotFound。測試:happy path、驗證失敗各分支、user 隔離、archived 分類的歷史交易仍可改 note/amount/date。
- [ ] 2.4 `application/` 分類 use cases:list(觸發 2.2)、create、update(name/icon/sort_order/archived;type 不可改)。同 user 同 type 重複名 → 400(先查再寫,不讓 unique violation 穿成 500)。測試:type 不可改、重複名 400、archived 後既有交易仍讀得到。
- [ ] 2.5 `application/get-monthly-summary.ts`:月統計,按幣別分列(totals: expense/income/net + by_category)。測試:跨幣別分列、net 計算、空月份空陣列、只含該 user。

## 3. Adapters + HTTP

- [ ] 3.1 `src/contexts/finance/adapters/`:`DrizzleFinanceCategoryRepository`、`DrizzleFinanceTransactionRepository`(summary 用 SQL group by;pg `SUM` 回 bigint 字串,cast number;update 顯式 `set({ updatedAt })`)。
- [ ] 3.2 `src/adapters/http/routes/finance.ts`:handler factories(照 water.ts 模式),驗證用現有 `requireX` helpers(`requireDay`/`requireMonth` 已存在);currency 白名單 `TWD/USD/JPY/EUR/CNY/KRW/GBP/HKD/AUD/CAD`(POST 預設 TWD、PUT 必填);typed error → HTTP 映射(NotFound→404 `{"error":"not_found"}`、其餘驗證→400)。
- [ ] 3.3 `src/adapters/http/app.ts` `createApp` 掛 `/api/finance/*`(auth middleware 後)、`src/index.ts` DI 注入,既有 route 不動。
- [ ] 3.4 route 測試(workers vitest,照現有模式注入 fake):CRUD + categories + summary 全 endpoint、401 未帶 token、user 隔離 404、PUT 缺 currency 400。

## 4. 收尾

- [ ] 4.1 `npm test` + `npm run typecheck` 全綠;確認 migration 檔已 commit。
