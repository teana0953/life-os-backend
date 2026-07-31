# Finance Net Worth(後端)— 設計

財務 sub-project 3:淨值追蹤(滿月記帳法簡化)。前置:#1 記帳、#2 預算已 merge。使用者決策:固定大分類(asset/liability)+ 科目自定、月快照覆蓋、後端先行。

## 目標

per-user 資產/負債科目(固定大分類 asset|liability,科目名自定,附預設種子)+ 每月市值快照(一月一筆一科目,覆蓋);算淨值=資產−負債、月成長率。TWD only(市值自填台幣,同 spreadsheet)。

## 範圍外

前端(下一 loop)、股票版(持股/未實現/已實現損益/股息/交易成本)、外幣自動換算、與記帳交易的自動連動(淨值是獨立手動快照,不從交易推算)。

## 資料模型(pgTable 慣例)

### `finance_networth_account`(科目)

- `id` uuid pk defaultRandom
- `user_id` uuid not null → `users.id`
- `kind` text not null(`asset` | `liability`,固定大分類,不可改)
- `name` text not null(科目名,自定,如「台幣活存」「股票」「學貸」)
- `sort_order` integer not null default 0
- `archived` boolean not null default false(軟刪:停用科目,歷史快照保留)
- `created_at` / `updated_at` timestamptz(update 顯式 set updatedAt)
- unique `(user_id, kind, name)`(同大類下科目名不重複)

### `finance_networth_snapshot`(月快照值)

- `id` uuid pk defaultRandom
- `user_id` uuid not null → `users.id`
- `account_id` uuid not null → `finance_networth_account.id`(cascade delete)
- `month` text not null(`YYYY-MM`)
- `value` integer not null(TWD 元;**資產/負債都存正數**,負債的正值代表「欠款金額」;淨值計算時 liability 減)
- `created_at` / `updated_at` timestamptz
- unique `(account_id, month)`;寫入用 upsert(月快照覆蓋語意)

### 預設科目種子(lazy,per-user)

首次 `GET /api/finance/networth/accounts` 且該 user 無任何科目(含 archived)時種:
- asset:台幣活存/台幣定存/外幣/股票/基金/儲蓄險(sort 0–5)
- liability:房貸或房租/信用卡/學貸/其他負債(sort 0–3)
- `onConflictDoNothing` 冪等(靠 unique index)

## API

**路由分層說明**(刻意與 #1#2 的扁平 `/api/finance/{transactions,budgets}` 不同):淨值有科目、快照、彙總、趨勢四種資源,集中在 `/api/finance/networth/*` 子樹下分層,避免頂層命名爆炸;`?month=` 查當月彙總是這棵子樹的根。


```
GET    /api/finance/networth/accounts              # 全部科目(含 archived);觸發 lazy 種子
POST   /api/finance/networth/accounts              { kind, name, sort_order? }
PUT    /api/finance/networth/accounts/:id          { name?, sort_order?, archived? }  # kind 不可改
GET    /api/finance/networth?month=YYYY-MM         # 該月快照+淨值+月成長率
PUT    /api/finance/networth/snapshots             { account_id, month, value }        # upsert 一格
GET    /api/finance/networth/trend?from=YYYY-MM&to=YYYY-MM   # 逐月淨值序列(趨勢用)
```

### 驗證

- `kind`:enum asset|liability;`name`:非空;`value`:非負整數(≥0;可為 0);`month`:`requireMonth`
- 科目名同大類重複 → 400(先查再寫,不讓 unique violation 穿 500)
- `account_id`:存在、屬同 user、未 archived(archived 科目不可寫新快照;既有快照仍讀)→ 否則 400/404
- 科目 `:id` 他人/不存在 → 404;kind 不可改(PUT 忽略或拒絕)

### `GET /api/finance/networth?month=` 回應

```json
{
  "month": "2026-07",
  "accounts": [
    { "account_id": "…", "kind": "asset", "name": "股票", "value": 350000 }
  ],
  "total_asset": 520000,
  "total_liability": 41484,
  "net_worth": 478516,
  "prev_net_worth": 460181,
  "growth_rate": 0.0398
}
```

- `total_asset`/`total_liability` = 該月各大類快照 SUM(SQL 彙總,bigint cast number)。**含 archived 科目的既有快照**——archived 只擋「寫新快照」,不追溯抹掉歷史值,否則封存科目會讓過去淨值憑空縮水。
- `net_worth` = total_asset − total_liability
- `prev_net_worth` = **最近一個「有任何快照」的較早月份**的淨值(不是曆法前一月——跳月時取實際有資料的上一筆);查詢月之前無任何快照 → `prev_net_worth: null`、`growth_rate: null`。前月淨值一律即時重算(asset SUM − liability SUM),不是存的欄位。
- `growth_rate` = (net_worth − prev_net_worth) / prev_net_worth;**prev ≤ 0 → null**(prev=0 除零;prev<0 時比率正負號反直覺、無意義,一律不給,前端只顯示絕對淨值變化)。
- 只列有科目的;某科目該月無快照 → 該格視為未填(不列或 value 缺,前端補 0——回應只列「有快照的」account 格,科目清單另由 accounts endpoint 給,前端合併)

### `GET /api/finance/networth/trend` 回應

```json
{ "points": [ { "month": "2026-01", "net_worth": 375041 }, … ] }
```

逐月淨值(每月 asset SUM − liability SUM),月份升序;**該月只要有任一科目快照就算「有資料」並列出**(淨值為已填科目之和,科目沒填齊會偏低,這是滿月記帳法「填多少算多少」的預期行為,不視為錯);完全無快照的月不列。SQL group by month。

## 架構落點

新 `src/contexts/finance/` 內延伸(同 context,不另開):
- `domain/`:`NetWorthAccount`、`NetWorthSnapshot` 實體;`NetWorthRepository` port(科目 CRUD、快照 upsert、月彙總、趨勢);typed errors(`NetWorthAccountNotFound`、`NetWorthAccountArchived`、`NetWorthAccountNameConflict`)。
- `application/`:`ensureDefaultAccounts`、`listAccounts`、`createAccount`、`updateAccount`、`upsertSnapshot`、`getMonthlyNetWorth`、`getNetWorthTrend`。
- `adapters/`:`DrizzleNetWorthRepository`(SUM 彙總、前月查詢、trend group by)。
- HTTP:`routes/finance.ts` 加 handlers;`app.ts` 掛、`index.ts` 組線。
- Migration:`npm run db:generate`。

## 測試(重要邏輯必須覆蓋)

- 科目 CRUD:驗證、同大類重名 400、kind 不可改、user 隔離、archived 科目不可寫快照/既有可讀。
- lazy 種子冪等。
- upsert 快照:覆蓋語意(同 account+month 二次寫只留一筆)、非負驗證。
- getMonthlyNetWorth:淨值計算(資產−負債)、月成長率(含首月 null、prev=0 null、正負成長)、跨幣別無關(全 TWD)、只含該 user、負債正值當減項。
- trend:逐月序列正確、空區間空陣列、月份升序。

## 驗收

`npm test` + `npm run typecheck` 全綠;淨值/成長率與 spreadsheet 範例手算一致(如 2月 -4.0%、3月 +10.7%)。
