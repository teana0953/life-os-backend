# Tasks

> **這是全案第一次讓資料跨使用者可見。** 每個 endpoint 動手前先問:未經授權的人能看到什麼?錯誤訊息會不會洩漏存在性?

## 1. Schema 與 migration

- [x] 1.1 `friendship`:`user_a_id`/`user_b_id` 正規化為 **UUID 小寫 canonical 字串序** a<b、unique `(user_a_id,user_b_id)`、**`CHECK (user_a_id < user_b_id)` 兜底**、**另建 `(user_b_id)` 索引**(listFriends 的 OR 那半)。`friend_invite`:`token_hash` unique、`expires_at`、`accepted_at`/`accepted_by_user_id`(**FK → users.id**)、`revoked_at`、index `(inviter_user_id)`。`npm run db:generate`。

## 2. Domain + application(授權邏輯,測試必須覆蓋)

- [x] 2.1 `src/contexts/social/domain/`:實體、兩個 port、typed errors(`InviteNotFound`/`InviteExpired`/`InviteAlreadyUsed`/`InviteRevoked`/`CannotFriendSelf`/`AlreadyFriends`)。**errors 要能讓 route 層區分過期 vs 已用 vs 撤銷**(spec 要求可分辨)。
- [x] 2.2 `application/create-invite.ts`:crypto 隨機 ≥32 bytes → base64url;雜湊用**確定性無鹽 SHA-256**(`crypto.subtle.digest`)——**不可用 bcrypt/argon2**(帶鹽就無法 `WHERE token_hash = H(token)` 查表、unique index 失效);**只回明文一次**;expires_at = now + 7d。測試:明文不入庫、同一 token 兩次雜湊結果相同(確定性)。
- [x] 2.3 `application/accept-invite.ts`:**不能用交易**(neon-http driver 直接 throw「No transactions support」,repo 無任何交易先例)——原子性靠 **單一 data-modifying CTE 語句**(`db.execute(sql\`…\`)`,完整 SQL 見 design.md)。順序:**先查是否已是好友**(是 → idempotent 回既有關係、**不執行 CTE、不消耗邀請**)→ 自己邀自己 400 → 執行 CTE claim。`claimed` 為空時**由步驟 1 預讀到的那筆 invite 判斷**四種原因(不存在/過期/已用/已撤銷)回對應 typed error——**不要再打一次查詢**;預讀當下有效但 CTE 空手 → 併發被搶 → AlreadyUsed。claim 成功但 `ON CONFLICT DO NOTHING` 沒插入 → 視為成功回既有關係。測試:spec 全部 scenario + 併發(fake 模擬 conflict)。
- [x] 2.3b **那條 CTE 是原子性的唯一承載者,而 repo 沒有 DB-backed 測試**(fake 測不到真 SQL)——實作後**逐字 review 該語句**並在 PR 說明中貼出來,不能只靠測試綠。
- [x] 2.4 `application/` 其餘:`listFriends`(正規化查詢兩欄都比對)、`removeFriend`(任一方可解)、`listMyInvites`、`revokeInvite`(他人 → NotFound)、`previewInvite`。
- [x] 2.5 **名稱衍生 + 結構性阻擋 email 外洩**:`displayName` 為 null 時回 email `@` 前綴(application 層算)。**不只是文字規則**——(a) repository 查詢只列舉需要欄位、不 `select *`;(b) 對外型別**根本沒有 email 欄位**,讓誤回在型別層就編譯不過。回應也不含 `accepted_by_user_id`。測試:payload 明確斷言不含 `@`。

## 3. Adapters + HTTP

- [x] 3.1 Drizzle 實作:正規化排序寫入(小寫 canonical 字串序);**accept 用 design.md「併發」節那條 data-modifying CTE 單一語句**(`db.execute(sql\`…\`)`)——**不可拆成「條件更新 + 另一條 insert」兩段**,那正是被否決的做法(insert 失敗時邀請已消耗、無法 rollback)。**不可用 `db.transaction`**(neon-http 直接 throw)。
- [x] 3.2 `routes/friends.ts`:七個 endpoint(**預覽也用 POST + body**,GET+query 一樣會進存取記錄與 Referer,沒把 token 移出記錄);typed error → HTTP 映射(NotFound→404 不洩漏存在性、其餘→400 且**過期/已用/已撤銷訊息可區分**)。**預覽需登入**。**token 走 request body 不進 URL path**(bearer credential 會進 Workers 存取記錄與 Referer);`DELETE /friends/:id` 的「不是好友」與「user 不存在」一律 404。
- [x] 3.3 `app.ts` 掛 `/api/friends/*`、`index.ts` 組線。
- [ ] 3.4 route 測試:全 endpoint 401/400/404/happy;**授權專項**——B 看不到 A 的邀請、撤銷不了 A 的邀請、拿別人的 token 預覽的行為。

## 4. 收尾

- [ ] 4.1 `npm test` + `npm run typecheck` 全綠;**逐一檢查所有回應 payload 無 email 外洩**(grep 測試斷言);migration 已 commit。
