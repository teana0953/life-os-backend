## Why

財務 sub-project 3(淨值追蹤,滿月記帳法簡化)。記帳(#1)+預算(#2)已 merge——處理現金流;淨值處理「身價」:資產減負債、逐月趨勢。使用者決策:固定大分類(asset/liability)+ 科目名自定、月快照覆蓋、TWD only、後端先行。

## What Changes

- 新表 `finance_networth_account`(per-user 科目:固定 `kind` asset|liability、`name` 自定、`archived` 軟刪、`(user_id,kind,name)` unique)與 `finance_networth_snapshot`(一科目一月一格 value,`(account_id,month)` unique,upsert 覆蓋)。
- `/api/finance/networth/*`:科目 GET(lazy 種子)/POST/PUT;快照 PUT upsert;`GET /networth?month=`(該月科目值+total_asset/total_liability/net_worth/prev_net_worth/growth_rate);`GET /networth/trend?from&to`(逐月淨值序列)。
- 科目預設種子:首次列出時 per-user lazy 種入(asset 6 類、liability 4 類),onConflictDoNothing 冪等。
- 淨值/月成長率在後端 SQL 彙總算(資產 SUM − 負債 SUM;成長率 (本−前)/前,首月/前值 0 → null)。

範圍外:前端 UI(下一 loop)、股票版損益/股息、外幣換算、與交易自動連動(淨值是獨立手動快照)。

## Capabilities

### New Capabilities

- `finance-networth`:資產/負債科目管理(固定大類+自定名+軟刪+lazy 種子)、月市值快照(upsert 覆蓋)、月淨值+成長率、逐月趨勢。

### Modified Capabilities

(無——不動記帳/預算既有行為;同 finance context 內新增。)

## Impact

- `src/shared/db/schema.ts` +2 表;新 migration。
- `src/contexts/finance/`:+networth domain/application/adapters(同 context 延伸)。
- `src/adapters/http/routes/finance.ts` +handlers;`app.ts`/`index.ts` 接線。
- 既有 endpoint 零行為變更。
