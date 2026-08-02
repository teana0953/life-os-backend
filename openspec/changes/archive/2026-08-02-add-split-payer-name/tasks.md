# Tasks

- [x] 1 `SplitExpense` 加 `payerDisplayName`
- [x] 2 `namesFor` 的輸入加上 `payerUserId`(**付款人可能不在 shares 裡**,純代墊時完全推不出來);`findById`/`listForUser`/`create`/`update` 都帶
- [x] 3 `expenseToJson` 加 `payer_display_name`
- [x] 4 測試:付款人不持 share 時,讀取者仍看得到付款人名字,且該名字不在任何 share 裡
- [x] 5 `npm run typecheck`、`npm test` 全綠
