# 好友(sub-project 4,後端)— 設計

財務藍圖的分帳三部曲第一步。**這是全案最大的架構轉折**:現有所有資料都嚴格按 user 隔離,好友是第一個「跨使用者可見」的東西,後面群組分帳與 settle up 都建在它上面。

## 使用者已裁定

- **雙向確認**:A 發邀請 → B 接受才成為好友(分帳涉及金錢,單向加人不合理;與 Splitwise 一致)
- **邀請連結一次性 + 7 天過期**(外洩也只能被用一次、時間有限)
- **好友列表只露名稱**(`displayName`,沒設就顯示 email 前綴——**不露完整 email**)

## 資料模型

### `friendship`

- `id` uuid pk
- `user_a_id` / `user_b_id` uuid not null → `users.id`
- `created_at` timestamptz
- **正規化**:一律以 `user_a_id < user_b_id`(UUID 字串序)儲存,配 unique `(user_a_id, user_b_id)`——一對好友只有一列,不會出現 A→B 與 B→A 兩筆。查詢時兩欄都要比對。

### `friend_invite`

- `id` uuid pk
- `inviter_user_id` uuid not null → `users.id`
- `token_hash` text not null unique(**存雜湊不存明文**——DB 外洩不等於邀請連結外洩)
- `expires_at` timestamptz not null(建立時 +7 天)
- `accepted_at` / `accepted_by_user_id` nullable(接受後填,一次性靠這個判定)
- `revoked_at` nullable(邀請人可撤銷)
- `created_at` timestamptz
- index `(inviter_user_id)`

**token 產生**:crypto 隨機 ≥32 bytes,base64url;明文只在建立時回傳一次(給前端組連結),之後只存雜湊。

## API

```
GET    /api/friends                     # 好友列表(只回 id + displayName)
DELETE /api/friends/:friendUserId       # 解除好友(雙向,任一方可解)
POST   /api/friends/invites             # 建立邀請 → { token, expires_at }
GET    /api/friends/invites             # 我發出、仍有效的邀請
DELETE /api/friends/invites/:id         # 撤銷
GET    /api/friends/invites/:token      # 預覽(誰邀請我;供接受頁顯示)
POST   /api/friends/invites/:token/accept
```

### 驗證與邊界(每條都要有測試)

- **接受自己的邀請** → 400(不能跟自己當好友)
- **已是好友再接受** → 400 或 idempotent 回既有關係(選 idempotent:重複點連結不該報錯,但**不得**消耗第二張邀請)
- **過期 / 已用 / 已撤銷** → 400,訊息要能區分(前端才能給對的提示:過期 vs 已被用過)
- **token 不存在** → 404(不洩漏存在性)
- 邀請列表只回自己發的;撤銷只能撤自己的(他人 → 404)
- `GET /invites/:token` 預覽**不需登入**?→ **需要登入**(避免未登入者掃 token;且前端流程本來就是先登入再重播 deep link)

### 併發

接受邀請必須在**單一交易**內:檢查未過期/未使用 → 標記 accepted → 建立 friendship。兩人同時點同一連結只能有一個成功(靠 `accepted_at IS NULL` 的條件更新 + friendship 的 unique)。

## 資訊揭露原則(貫穿本 sub-project)

- 好友列表、邀請預覽**只回 `displayName`**;`displayName` 為 null 時回 email 的 `@` 前綴(後端算好再回,前端不碰 email)。
- **不提供任何「用 email/名稱搜尋使用者」的 endpoint**——那是列舉攻擊面,而且本設計不需要(只靠邀請連結)。

## 架構落點

新 context `src/contexts/social/`(**不放 finance 底下**——好友是跨域概念,之後群組分帳會用,但健康域未來也可能用):
- `domain/`:`Friendship`、`FriendInvite` 實體;`FriendshipRepository`、`FriendInviteRepository` port;typed errors(`InviteNotFound`/`InviteExpired`/`InviteAlreadyUsed`/`InviteRevoked`/`CannotFriendSelf`/`AlreadyFriends`)
- `application/`:`listFriends`、`removeFriend`、`createInvite`、`listMyInvites`、`revokeInvite`、`previewInvite`、`acceptInvite`
- `adapters/`:Drizzle 實作(含正規化排序、交易內接受)
- HTTP:`routes/friends.ts`;`app.ts` 掛、`index.ts` 組線

## 範圍外

- 前端(下一 loop)
- 群組、分帳、settle up(sub-project 5/6)
- 好友備註/暱稱、封鎖、好友分組
- 用 email 搜尋使用者(刻意不做,見上)

## 測試

- 正規化:A 邀 B 與 B 邀 A 產生同一列;查詢兩欄皆命中
- 一次性:同一 token 接受兩次,第二次 400;**且第一次的 friendship 仍在**
- 過期/撤銷/自己邀自己/已是好友 各自的行為
- 併發:模擬兩個 accept 同時進來,只有一個建立 friendship(fake repository 模擬 conflict)
- 資訊揭露:回應 payload **不含 email**(明確斷言),displayName 為 null 時回前綴
- user 隔離:B 看不到 A 的邀請列表、撤銷不了 A 的邀請

## 驗收

`npm test` + `npm run typecheck` 全綠;上述邊界皆有測試;回應無 email 外洩。
