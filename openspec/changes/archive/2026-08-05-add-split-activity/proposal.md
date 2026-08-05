## Why

分帳看不到「別人做了什麼」,而最需要看到的兩件事**現在完全無從得知**:

- **刪除之後什麼都不剩。** `deleteExpense` 刪掉列(shares cascade),使用者只會發現餘額突然變了。
- **修改只留下 `updatedAt`。** `updateExpense` 沒記錄改了什麼,連 `updatedByUserId` 都沒有。

這兩件正是會改變你欠多少、而你不會被通知的事。「A 新增了一筆」支出列表看得到;「A 把那筆 $2000 刪了」看不到。

## What Changes

- 新增 `split_activity` 表,記錄八個寫入用例(建立/修改/刪除支出、建立/刪除還款、建立群組、加成員、封存群組)。
- **活動列是自足的快照**(金額、幣別、描述、群組名、對象名),不是指向可能已消失的列的外鍵。
- **快照要包含「誰看得到」。** 無群組支出的可見範圍是參與者,而參與者存在 `split_share` 裡、支出一刪就 cascade 掉——所以受眾必須在事件發生當下就凍結,否則對這個功能最該服務的情況(刪除)完全失效。
- **活動的 insert 必須與被記錄的異動在同一個 `db.batch`。八個裡只有三個現在有 batch**(expense create/update、group create);其餘五個(expense delete、settlement create/delete、group archive/addMember)都要改。
- **expense delete 與 settlement delete 還要把存在性檢查併進同一個語句**(`INSERT ... SELECT ... WHERE EXISTS`):它們現在是「先讀再寫」,並發的雙重刪除會讓呼叫端拿到 404 而活動照樣寫進去。**`archive` 需要的是另一個條件**——群組永遠不會被刪除,所以「列還在」守的是到不了的狀態,但 `archived_at` 單向、重複封存到得了:改成 `archived_at is null`,否則連按兩下就讓時間軸說封存了兩次。而且這條測試要寫在 **repository 層**:use case 會先 `findById` 並在那裡拋錯,寫在那一層的測試無條件 insert 也會通過。
- 新增查詢端點:依可見範圍回傳使用者的動態時間軸。
- `update-expense` 的事件要存**改前/改後的金額**(金額沒變也照存)——只寫「修改了」等於沒說。
- 還款的事件要存**方向**(actor 是不是付錢的那一方)——不存的話「你付給 B 500」與「B 付給你 500」是同一列,而還款一刪就再也問不到。

## Capabilities

### Modified Capabilities

- `split-bills`:新增動態記錄與查詢。

## Impact

- 新 migration、新 repository、新 use case、新端點,以及**八個既有寫入路徑各多一筆同交易的 insert**。
- **可見範圍寫錯 = 洩漏別人的資料**,比餘額算錯嚴重。用 PGlite 對真 Postgres 驗(`test/db/`,PR #71 的 harness),fixture 要有多樣性,並明確測「非參與者看不到」。
- **原子性測得到,但要先替 harness 加一個 `batch` shim。** `test/db/harness.ts` 說的是 `drizzle-orm/pglite` 沒有 `batch`,不是「無法原子」——PGlite 是單連線,用 `BEGIN` / `COMMIT` / `ROLLBACK` 包住預先建好的語句就能跑,拿到對真 Postgres 的證據。假 `Db` 的結構性斷言留作第二層,不是主要證據。
- **port 簽章與所有 in-memory fake 都要改**(八個寫入路徑多一個參數)。
- 反正規化的快照與現況會不一致(支出改名後舊活動仍顯示舊名)——**這是刻意的**,活動是「當時發生了什麼」。
- 只做後端;前端(分帳分頁內的「動態」分頁)是下一個 change。
