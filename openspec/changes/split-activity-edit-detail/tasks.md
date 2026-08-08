# Tasks

- [x] 1.1 `split_activity` 加 `changed_fields` / `added_display_names` / `removed_display_names`,加 migration。
- [x] 1.2 字彙用 CHECK 擋(`<@ array[...]`)—— 拼錯的欄位名是一個讀者永遠不會被告知的變更。
- [x] 1.3 CHECK:非 `expense_updated` 的列這三欄一律 null。
- [x] 2.1 `update` 讀改前的 `currency` / `description` / `day`(原本只讀 `amount` / `payer` / `group`)。
- [x] 2.2 **改前的分攤一律讀**,不再只有無群組才讀 —— 分攤 diff 兩種都需要。
- [x] 2.3 `shares` 同時涵蓋「集合變了」與「同一群人之間重新分配」。**突變:只比集合**,一條「重新分配」的測試必須紅。
- [x] 2.4 加入/移出存**名字**。**突變:存 id**,必須紅。**突變:兩者對調**,必須紅。
- [x] 3.1 `SplitActivity` 型別與 `activityToJson` 接上。
- [x] 3.2 **突變:把 `[]` 收斂成 `null`**,必須紅 —— 需要一個 fixture 真的是空陣列,不然這條抓不到(第一次就漏了)。
- [x] 4.1 `npm test`、`npm run typecheck` 全綠,`drizzle-kit check` 通過。
