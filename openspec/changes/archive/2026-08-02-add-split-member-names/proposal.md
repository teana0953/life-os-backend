## Why

分帳後端(PR #65)的群組成員與支出 shares 只回 `user_id`,沒有名字。唯一帶 `display_name` 的是餘額端點,而它**刻意省略淨額為 0 的人**——所以一個已結清的群組成員在畫面上只剩一串 uuid,前端無解。好友列表也補不齊:群組成員不一定是呼叫者的好友。

這是分帳前端做不下去的前提,不是新功能。

## What Changes

- `GroupMember` 加 `displayName`(從 `users` join,沿用 `splitDisplayName` 的 null/email 降級規則);`GET /api/split/groups/:id` 與 `POST /api/split/groups/:id/members` 的成員 JSON 加 `display_name`。
- `GET /api/split/groups` 的每個群組加 `members`,一次帶回所有群組的成員與名字——**新增 `listMembersForGroups(groupIds)` 一次查完**,不是一個群組一趟。

**shares 不加名字**,因為不需要:群組支出的分擔人必然是該群組的成員(授權規則保證),無群組支出的分擔人必然是呼叫者的好友——兩邊的名字前端都已經拿得到,加在 share 上只是把同一份資料再序列化一次。

## Capabilities

### Modified Capabilities

- `split-bills`:群組成員帶名字。

## Impact

- 修改 `src/contexts/split/domain/expense-group.ts`、`expense-group-repository.ts`、`adapters/drizzle-expense-group-repository.ts`、`application/list-my-groups.ts`、`src/adapters/http/routes/split.ts`,與對應測試。
- 回應形狀**只增不減**,前端無破壞性變更。
