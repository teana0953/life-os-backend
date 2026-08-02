# Tasks

- [x] 1 `GroupMember` 加 `displayName`;`toMember` 從 join 來的 `users.display_name`/`email` 走 `splitDisplayName`
- [x] 2 `listMembers` 改 inner join `users`;`addMember` 插入後補查名字
- [x] 3 新增 `listMembersForGroups(groupIds)`(`inArray`,一次查完)
- [x] 4 `listMyGroups` 回 `{ group, members }`,members 用單次 `listMembersForGroups` 分組
- [x] 5 `memberToJson` 加 `display_name`;`GET /api/split/groups` 每個群組加 `members`
- [x] 6 測試:群組詳情與列表都帶名字(含已結清成員)、members 只查一次、既有測試不破
- [x] 7 `npm run typecheck`、`npm test` 全綠
