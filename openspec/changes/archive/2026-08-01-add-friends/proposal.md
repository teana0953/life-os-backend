## Why

財務藍圖 sub-project 4。分帳三部曲(好友 → 群組分帳 → settle up)的第一步,也是**全案最大的架構轉折**:現有所有資料嚴格按 user 隔離,好友是第一個跨使用者可見的東西,後兩個 sub-project 都建在它上面。這塊的授權模型做對了,後面才穩。

## What Changes

- 新 context `src/contexts/social/`(不放 finance 底下——好友是跨域概念)。
- 兩張表:`friendship`(**正規化**為 `user_a_id < user_b_id` 單列 + unique,不會有 A→B/B→A 兩筆)與 `friend_invite`(**存 token 雜湊不存明文**、7 天過期、一次性、可撤銷)。
- `/api/friends/*`:好友列表/解除、邀請建立(回明文 token 一次)/列出/撤銷/預覽/接受。
- 接受邀請的原子性由**單一 data-modifying CTE 語句**承擔(neon-http driver 不支援交易,直接 throw)——claim 邀請與建立 friendship 在同一條 SQL 內完成,兩人同時點同一連結只有一個成功,且邀請絕不會在沒建立 friendship 的情況下被消耗。

使用者裁定的三個決策:雙向確認(需對方接受)、邀請連結一次性 + 7 天過期、好友列表**只露名稱不露 email**。

**刻意不做**:用 email/名稱搜尋使用者的 endpoint——那是列舉攻擊面,且本設計靠邀請連結就夠。

範圍外:前端(下一 loop)、群組/分帳/settle up、好友備註、封鎖。

## Capabilities

### New Capabilities

- `friends`:雙向好友關係(正規化單列)、一次性帶期限的邀請連結、最小資訊揭露的好友列表。

## Impact

- `src/shared/db/schema.ts` +2 表;新 migration。
- 新增 `src/contexts/social/**`、`src/adapters/http/routes/friends.ts`;`app.ts`/`index.ts` 接線。
- 既有 endpoint 零行為變更——但這是第一次有資料跨使用者可見,授權邊界需特別審。
