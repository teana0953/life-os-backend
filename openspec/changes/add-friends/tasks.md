# Tasks

> **這是全案第一次讓資料跨使用者可見。** 每個 endpoint 動手前先問:未經授權的人能看到什麼?錯誤訊息會不會洩漏存在性?

## 1. Schema 與 migration

- [ ] 1.1 `friendship`(`user_a_id`/`user_b_id`,**正規化為 a<b 的 UUID 字串序**,unique `(user_a_id,user_b_id)`)與 `friend_invite`(`token_hash` unique、`expires_at`、`accepted_at`/`accepted_by_user_id`、`revoked_at`、index `(inviter_user_id)`)。`npm run db:generate`。

## 2. Domain + application(授權邏輯,測試必須覆蓋)

- [ ] 2.1 `src/contexts/social/domain/`:實體、兩個 port、typed errors(`InviteNotFound`/`InviteExpired`/`InviteAlreadyUsed`/`InviteRevoked`/`CannotFriendSelf`/`AlreadyFriends`)。**errors 要能讓 route 層區分過期 vs 已用 vs 撤銷**(spec 要求可分辨)。
- [ ] 2.2 `application/create-invite.ts`:crypto 隨機 ≥32 bytes → base64url;**只回明文一次,存雜湊**;expires_at = now + 7d。測試:雜湊不可逆推、明文不入庫。
- [ ] 2.3 `application/accept-invite.ts`:**單一交易**內檢查(未過期/未使用/未撤銷)→ 標記 accepted → 建立正規化 friendship。自己邀自己 400;已是好友 → **idempotent 回既有關係且不消耗邀請**。測試:spec 全部 scenario + 併發(fake 模擬 conflict,只有一個成功)。
- [ ] 2.4 `application/` 其餘:`listFriends`(正規化查詢兩欄都比對)、`removeFriend`(任一方可解)、`listMyInvites`、`revokeInvite`(他人 → NotFound)、`previewInvite`。
- [ ] 2.5 **名稱衍生**:`displayName` 為 null 時回 email `@` 前綴——**在 application 層算好**,email 不得離開後端。測試:回應 payload 明確斷言不含 `@`。

## 3. Adapters + HTTP

- [ ] 3.1 Drizzle 實作:正規化排序寫入、accept 的交易(`accepted_at IS NULL` 條件更新 + friendship unique 兜底)。
- [ ] 3.2 `routes/friends.ts`:七個 endpoint;typed error → HTTP 映射(NotFound→404 不洩漏存在性、其餘→400 且訊息可區分)。**預覽需登入**。
- [ ] 3.3 `app.ts` 掛 `/api/friends/*`、`index.ts` 組線。
- [ ] 3.4 route 測試:全 endpoint 401/400/404/happy;**授權專項**——B 看不到 A 的邀請、撤銷不了 A 的邀請、拿別人的 token 預覽的行為。

## 4. 收尾

- [ ] 4.1 `npm test` + `npm run typecheck` 全綠;**逐一檢查所有回應 payload 無 email 外洩**(grep 測試斷言);migration 已 commit。
