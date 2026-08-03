# Tasks

**這一期不改任何 production 程式碼。** 目標是把「SQL 從沒被執行過」這個缺口補上;若測試抓到 bug,單獨處理並在報告裡講清楚,不順手改。

## 1. 基礎建設

- [ ] 1.1 `@electric-sql/pglite` 加為 devDependency(**可行性探針已經裝過了**,`package.json` 裡已有;確認版本並保留)(已驗證與 drizzle 0.45.2 自帶的 `drizzle-orm/pglite` driver/migrator 相容,不需升級 drizzle)
- [ ] 1.2 第三個 Vitest project `db`,include **只收 `test/db/**/*.test.ts`**——用 `test/db/**` 會把 `harness.ts` 當成測試檔,跑起來是 `No test suite found in file`;併進 `npm test`
- [ ] 1.3 `test/db/harness.ts`:開 PGlite → `migrate(db, { migrationsFolder: "./drizzle" })` → 回傳可餵給 repository 的 `Db`。**`as unknown as Db` 只在這一個檔案出現**,並註解說明它換掉什麼
- [ ] 1.3b 測試間怎麼清乾淨要明確:**每個測試檔開一個新的 PGlite instance**(約 1.1 秒,可接受)還是共用 instance + 每個 case `TRUNCATE`。選後者的話 **FK 順序要處理**(`TRUNCATE ... CASCADE`,或先子表後父表),否則會撞外鍵。選一種、寫進註解、不要兩種混用
- [ ] 1.4 harness 的註解要寫明兩個限制,否則下一個人會以為都蓋到了:
  - **pglite driver 沒有 `batch`** → 用 `db.batch` 的原子寫入路徑無法照原樣跑;測試改成直接插列準備資料、驗讀取端。**證明的是「查詢寫對了」,不是「一批寫入是原子的」**
  - **PGlite 不是 Neon** → 證明的是 SQL 語意;連線層行為(neon-http 無交易、逾時、連線池)不在覆蓋範圍
- [ ] 1.5 量一次**整體 `npm test`** 的時間變化並記錄——探針的約 1.1 秒是**單一 PGlite instance** 的成本,不是整個 suite 的;檔案數乘上去才是真正的代價

## 2. 可見性(錯了整批洩漏別人的支出)

- [ ] 2.1 `DrizzleSplitExpenseRepository.listForUser`:非參與者的結果**不含**該筆支出(反向案例)
- [ ] 2.2 持有 share 的人看得到;付款人看得到
- [ ] 2.3 **群組成員即使不持 share 也看得到**(靠 membership 的那條 `EXISTS`)
- [ ] 2.4 `with=` 只回**無群組**的支出,群組支出不得混進來
- [ ] 2.5 `group_id=` 回該群組全部
- [ ] 2.6 **每一條都要有自己的突變,不是只有 2.1**。至少:
  - 參與條件改成恆真 → 2.1 紅
  - 拿掉 membership 的那條 `EXISTS` → 2.3 紅(它存在是因為過去的 bug)
  - `with=` 的 `group_id IS NULL` 拿掉 → 2.4 紅
  - `group_id=` 的篩選拿掉 → 2.5 紅
  - **2.2(持有 share 的人看得到)**:弄鬆的錯誤由 2.1 抓,所以要弄緊——把 share 的 `EXISTS` 條件改成 `ss.user_id = se.payer_user_id`。**但這條突變只在「付款人自己不持 share」的 fixture 上才咬得到**(否則付款人仍在 share 裡,B 照樣看得到,紅的會變成 2.1)。所以 2.2 要用**純代墊**的支出:A 付 300、share 只有 B

## 3. 餘額方向與金額

- [ ] 3.1 雙人:被欠、欠人各一,斷言**有號數值**
- [ ] 3.2 部分還款(450 欠、還 300 → 150)、還清(消失)、多還(翻向另一邊)
- [ ] 3.3 群組:每位成員對整個群組的淨額,對**指名成員**斷言有號數值;零和只當附加檢查,**不當方向檢查**。**fixture 一定要包含一筆該群組的還款**——沒有還款的話 3.6 的群組符號對調是無效突變(探針驗過結果完全相同),那條方向就仍然沒被證明
- [ ] 3.4 **付款人自己那份在餘額被排除**(不會出現自己欠自己)
- [ ] 3.5 多幣別:永不相加;結清其中一種,另一種不動
- [ ] 3.6 **每一條都要有自己的突變**。至少:
  - 雙人的兩個還款符號對調 → 3.2 紅(探針驗過會得到 750)
  - 群組的符號對調 → 3.3 紅
  - 支出那兩條腿的符號對調 → 3.1 紅
  - **3.4 的突變不是拿掉 `ss.user_id != se.payer_user_id`** —— 那在 `balancesForGroup` 裡是代數上的 no-op(付款人自己那份以 `+a` 與 `−a` 落在同一個 counterpart 上互相抵銷,探針驗過改前改後都是 A=200/B=−100/C=−100),而 `balancesForUser` 裡根本沒有這個述詞。正確的是:**拿掉 `balancesForUser` 第一條腿的 `ss.user_id != ${me}`** → 得到 A=150、B=150,也就是自己欠自己 → 3.4 紅
  - **不要用「拿掉 `GROUP BY` 的 currency」當突變**——那會讓整個查詢報錯、整檔紅,證明不了任何跟幣別有關的事。改成**把兩個幣別的 row 併成同一個 key**(例如 `GROUP BY` 裡把 `net.currency` 換成常數字面值)→ 3.5 紅

## 4. 自付額與群組成員

- [ ] 4.1 `splitSpendingForUser`:按幣別分列;**付款人自己那份要計入**(與 3.4 方向相反,兩條規則各驗一次)
- [ ] 4.2 ~~還款不算自付額~~ **不寫這條測試,也不改 src**:`splitSpendingForUser` 完全不讀 `split_settlement`,兩者是不同的表,所以這是**結構上的事實**,沒有任何突變能讓測試變紅——正是這個 change 要消滅的那種測試。說明它為什麼不需要排除還款的註解**已經在 `drizzle-split-expense-repository.ts` 裡了**,不需要新增(新增也會違反 5.2 的「不碰 production 程式碼」)
- [ ] 4.3 月份篩選只取該月;空月份回空陣列
- [ ] 4.4 `shareAnyGroup`:有共同群組 / 沒有,各一
- [ ] 4.5 **每一條都要有自己的突變**。至少:
  - `split_share`→`split_expense` 的 join 改錯 → 4.1 的金額斷言紅
  - **4.1 的「付款人自己那份要計入」需要自己的突變**:把餘額查詢那條 `ss.user_id != se.payer_user_id` 的排除**加進** `splitSpendingForUser` → 付款人自己那份消失 → 該斷言紅。這條是 spec 四個具名情境之一,不能沒有突變
  - `to_char(day,'YYYY-MM')` 的月份條件改錯 → 4.3 紅
  - 同理,4.1 的多幣別斷言不要用「拿掉 `GROUP BY`」;改成把 `GROUP BY` 的 currency 換成常數 → 兩種幣別被併成一列 → 該斷言紅
  - `shareAnyGroup` 的自我 join 條件改錯 → 4.4 紅

## 5. 收尾

- [ ] 5.1 `npm run typecheck`、`npm test` 全綠
- [ ] 5.2 確認 `git diff -- src/` **是空的**——這一期不碰 production 程式碼
- [ ] 5.3 報告裡列出:**每一條測試對應的突變與結果**(不是抽樣)、整體測試時間變化、以及**哪些東西仍然沒被覆蓋**(batch 原子性、連線層行為、health/notifications 等其他 context 仍在用會丟掉參數的假 `Db`)
- [ ] 5.4 若有任何一條新測試找不到能讓它變紅的突變,**不要留著它**——寫下為什麼,並改成註解或直接刪掉
