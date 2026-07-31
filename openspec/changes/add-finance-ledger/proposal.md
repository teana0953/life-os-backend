## Why

lifeos 要新增與「健康」平行的「財務」大域。整體藍圖(個人記帳 → 預算 → 淨值 → 好友 → 群組分帳 → settle up)已由使用者核准,正本在 `life-os/docs/superpowers/specs/2026-07-31-finance-ledger-design.md`。本 change 是第一個 sub-project 的後端切片:個人記帳核心。沒有它,前端財務頁沒有 API 可接。

## What Changes

- 新 context `src/contexts/finance/`(domain/application/adapters),照現有 context 分層。
- 兩張新表(Neon Postgres,照現有 pgTable/uuid/timestamptz 慣例):`finance_category`(per-user 分類,`archived` 軟刪,`(user_id, type, name)` unique)與 `finance_transaction`(支出/收入交易,金額存最小幣別單位整數,幣別白名單,`day` date 欄)。Drizzle migration。
- 新 route `src/adapters/http/routes/finance.ts` 掛 `/api/finance/*`(`app.ts` `createApp` 註冊、`index.ts` DI):交易 CRUD、分類 list/create/update(無 delete,只有 archived)、`GET /api/finance/summary?month=` 月統計(SQL 彙總,按幣別分列不換算)。
- 分類預設種子:首次 `GET /api/finance/categories` 時 per-user lazy 種入(expense 7 類、income 4 類),`onConflictDoNothing` 冪等。
- 全部 endpoint 走既有 Firebase auth middleware,user 隔離(他人資料一律 404)。

範圍外(之後的 sub-project):預算、淨值、分帳/群組/好友、推播、匯率換算、子分類。schema 不預建這些表。

## Capabilities

### New Capabilities

- `finance-ledger`:個人記帳——交易 CRUD、per-user 分類(含 lazy 預設種子與軟刪)、月統計 summary(按幣別分列)。

### Modified Capabilities

(無——不動既有 capability 的行為。)

## Impact

- `src/shared/db/schema.ts`:+2 表;新 migration。
- `src/adapters/http/app.ts`:`createApp` 掛 finance routes;`src/index.ts`:DI 注入(既有 route 不動)。
- 新增 `src/contexts/finance/**`、`src/adapters/http/routes/finance.ts`、對應測試。
- 不碰既有 context/route/表;對現有功能零行為變更。
