# Tasks

## 1. Schema 與 migration

- [x] 1.1 `src/shared/db/schema.ts` 加 `finance_networth_account`(`(user_id,kind,name)` unique)與 `finance_networth_snapshot`(`(account_id,month)` unique、account cascade delete),`npm run db:generate`,`npm run typecheck` 過。

## 2. Domain + application(重要邏輯,測試必須覆蓋;unit fake repository)

- [x] 2.1 `domain/`:`NetWorthAccount`/`NetWorthSnapshot` 實體、`NetWorthRepository` port(科目 CRUD、快照 upsert、月彙總 asset/liability SUM、前月淨值、trend group by)、typed errors(`NetWorthAccountNotFound`/`NetWorthAccountArchived`/`NetWorthAccountNameConflict`)。
- [x] 2.2 `application/ensure-default-accounts.ts`:無科目時種預設(asset 台幣活存/台幣定存/外幣/股票/基金/儲蓄險 sort 0–5;liability 房貸或房租/信用卡/學貸/其他負債 0–3),onConflictDoNothing 冪等。測試:兩次不重種。
- [x] 2.3 `application/` 科目 use cases:list(觸發 2.2)、create、update(name/sort_order/archived;kind 不可改)。同大類重名 400(先查再寫)。測試:重名 400、kind 不可改、user 隔離。
- [x] 2.4 `application/upsert-snapshot.ts`:非負驗證、account 存在/同 user/未 archived、覆蓋語意。測試:覆蓋、負值 400、archived 400、他人 404。
- [x] 2.5 `application/get-monthly-networth.ts`:total_asset/total_liability(SUM)、net_worth=資產−負債、prev_net_worth(前月)、growth_rate((本−前)/前;首月/prev≤0 → null)。測試:淨值計算、成長率各分支(用 spec 內建例:asset 520000 − liability 41484 = net 478516,prev 460181 → growth ≈0.0398;首月 prev=null;prev≤0→null)、只含該 user。
- [x] 2.6 `application/get-networth-trend.ts`:逐月淨值序列、月升序、空區間空陣列。測試:序列正確、跳月不列、空。

## 3. Adapters + HTTP

- [x] 3.1 `adapters/drizzle-networth-repository.ts`(SUM 彙總 bigint cast;前月查詢;trend group by month;upsert 用 onConflictDoUpdate;update 顯式 updatedAt)。
- [x] 3.2 `routes/finance.ts` +handlers(科目 GET/POST/PUT、快照 PUT、networth GET、trend GET);驗證用現有 requireX/requireMonth;typed error → HTTP 映射(404 not_found / 400)。
- [x] 3.3 `app.ts` 掛 `/api/finance/networth/*`、`index.ts` 組線,既有 route 不動。
- [x] 3.4 route 測試(workers vitest 注入 fake):全 endpoint 401/400/404/happy、networth 與 trend 回應形狀。

## 4. 收尾

- [x] 4.1 `npm test` + `npm run typecheck` 全綠;migration 已 commit。
