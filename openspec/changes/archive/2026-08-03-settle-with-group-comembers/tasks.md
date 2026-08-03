# Tasks

- [x] 1 `ExpenseGroupRepository.shareAnyGroup(userId, otherUserId)`——成員表自我 join + `limit(1)`(述詞,不是列表;一對人可能共享多個群組)
- [x] 2 `createSettlement` 的無群組分支改成「是好友 **或** 有共同群組」
- [x] 3 測試:非好友但同群組 → accepted 且 `groupId` 仍為 null;兩者皆非 → 仍 `NotFriends`
- [x] 4 `npm run typecheck`、`npm test` 全綠
