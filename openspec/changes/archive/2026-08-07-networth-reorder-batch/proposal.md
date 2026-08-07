## Why

issue #80:淨值科目目前只能一筆一筆改 `sort_order` 來調整順序,前端拖曳排序要為
每一筆改動打一個 `PUT /accounts/:id`。同一組拖曳的中途若有一個請求失敗,使用者
會看到一組「一半新順序、一半舊順序」的混亂列表,而且沒有辦法整組重試。

## What Changes

- 新增 `PUT /api/finance/networth/accounts/order`:body `{ kind, ids[] }`,
  依 `ids` 的順序把該 `kind` 底下每個科目的 `sort_order` 設成它在陣列中的
  索引(0-based),**整組寫入是一個原子操作**(`db.batch`,失敗則全部不生效)。
- `ids` 必須**剛好等於**該使用者該 `kind` 的全部科目 id 集合(含已封存的) ——
  不是子集、不是超集、也不能混進另一個使用者或另一個 `kind` 的 id。任何一種
  不符都拒絕(400)且不寫入任何一筆。
- 已封存的科目與未封存的科目共用同一個排序空間:封存科目也必須出現在 `ids`
  裡,也會拿到自己的 `sort_order`。

## Capabilities

### Modified Capabilities

- `finance-networth`:淨值科目新增批次重排序端點。

## Impact

- 新增一個 driven-port 方法 `NetWorthRepository.reorderAccounts`,以及對應的
  use case `reorderNetWorthAccounts` 與 Drizzle 實作(`db.batch`)。
- 路由必須註冊在既有的 `PUT /accounts/:id` **之前**,否則 `/accounts/order`
  會被 `:id` 路由以 `id="order"` 吃掉。
- 只做後端;前端排序 UI 是另一個 repo 的後續 change。
