# Tasks

- [x] 1 `SplitShare` 拆成 `SplitShareInput`(寫)與 `SplitShare`(讀,多 `displayName`);calculator、validator、repository 的寫入型別改用 Input
- [x] 2 `DrizzleSplitExpenseRepository` 加 `namesFor(userIds)`——**一次查詢解析整批**,不是 join(join 會讓 expense 列隨 share 數重複);`findById`/`listForUser`/`create`/`update` 都帶名字
- [x] 3 `expenseToJson` 的 share 加 `display_name`
- [x] 4 測試:A 建立 A/B/C 三人分帳(B、C 互不為好友),B 讀得到 C 的名字
- [x] 5 `npm run typecheck`、`npm test` 全綠
