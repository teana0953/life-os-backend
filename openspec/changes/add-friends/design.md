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
- **正規化**:一律以 `user_a_id < user_b_id` 儲存,配 unique `(user_a_id, user_b_id)`——一對好友只有一列,不會出現 A→B 與 B→A 兩筆。查詢時兩欄都要比對。
  **比較基準釘死**:以 **UUID 的小寫 canonical 字串**(`8-4-4-4-12`)做字串比較。Postgres 的 `uuid` 型別比的是 byte 序、JS 比的是字串序,兩者**只在小寫 canonical 形式下一致**——所有進出都必須是這個形式。
  **DB 層兜底**:加 `CHECK (user_a_id < user_b_id)`,不讓正規化只靠 application 自律。
- **索引**:`(user_a_id)` 由 unique 涵蓋,但 `listFriends` 的 `OR user_b_id = me` 那半需要**另建 `(user_b_id)` 索引**,否則 seq scan。

### `friend_invite`

- `id` uuid pk
- `inviter_user_id` uuid not null → `users.id`
- `token_hash` text not null unique(**存雜湊不存明文**——DB 外洩不等於邀請連結外洩)
  **演算法必須是確定性、無鹽的 SHA-256**(`crypto.subtle.digest('SHA-256', …)`,hex 或 base64url 編碼)。**不可用 bcrypt/argon2 這類帶鹽 KDF**——查表靠 `WHERE token_hash = H(token)`,帶鹽就無法比對、unique index 也失效。token 本身是 ≥32 bytes 的高熵隨機值,不需要 KDF 的抗暴力特性。
- `expires_at` timestamptz not null(建立時 +7 天)
- `accepted_at` timestamptz nullable / `accepted_by_user_id` uuid nullable **→ `users.id`**(接受後填,一次性靠 `accepted_at IS NULL` 判定)
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
GET    /api/friends/invites/preview     # 預覽(誰邀請我);**token 走 query 或 body,不進 path**
POST   /api/friends/invites/accept      # 接受;**token 走 request body**
```

### 驗證與邊界(每條都要有測試)

- **接受自己的邀請** → 400(不能跟自己當好友)
- **已是好友再接受** → 400 或 idempotent 回既有關係(選 idempotent:重複點連結不該報錯,但**不得**消耗第二張邀請)
- **過期 / 已用 / 已撤銷** → 400,訊息要能區分(前端才能給對的提示:過期 vs 已被用過)
- **token 不存在** → 404(不洩漏存在性)
- 邀請列表只回自己發的;撤銷只能撤自己的(他人 → 404)
- `DELETE /api/friends/:friendUserId`:「不是好友」與「該 user 不存在」**一律 404**(不洩漏存在性)
- **邀請建立無數量上限**——這是有意識的取捨(單人自用 app,濫發只影響自己);若日後開放註冊規模變大需重審。
- 已解除好友後,舊的未使用邀請仍可用來重新建立關係——符合直覺,不特別處理。
- 預覽**需要登入**(避免未登入者掃 token;且前端流程本來就是先登入再重播 deep link)
- **token 不放 URL path**:它是 bearer credential,放 path 會進 Workers 存取記錄與 `Referer` 標頭。accept 一律走 request body;預覽同理(若前端實作上必須用 query,需在該處記下取捨)。前端的邀請**連結**本身仍帶 token(那是使用者手上的憑證),但打 API 時改放 body。

### 併發:**不能用交易,必須用單一 CTE 語句**

初版寫「單一交易」,**在本 repo 不成立**——`src/shared/db/client.ts` 用 `drizzle-orm/neon-http`,該 driver 的 session 直接 `throw new Error("No transactions support in neon-http driver")`;repo 全域也沒有任何 `db.transaction` 先例。

可用選項只有兩個,且只有第二個適用:
- `db.batch([...])` 底層確實是單一 Postgres 交易,但**非互動式**、無法依讀取結果分支 → 不適用 accept。
- **單一 data-modifying CTE 語句**(用 `db.execute(sql\`…\`)`):

```sql
WITH claimed AS (
  UPDATE friend_invite
     SET accepted_at = now(), accepted_by_user_id = $me
   WHERE token_hash = $h
     AND accepted_at IS NULL
     AND revoked_at IS NULL
     AND expires_at > now()
  RETURNING inviter_user_id
)
INSERT INTO friendship (user_a_id, user_b_id)
SELECT LEAST(inviter_user_id, $me), GREATEST(inviter_user_id, $me) FROM claimed
ON CONFLICT DO NOTHING
RETURNING *;
```

**為什麼非這樣不可**:若拆成兩條獨立 HTTP 語句,「條件更新成功但 friendship insert 失敗」時邀請已被消耗且**無法 rollback**,直接違反「一次性且失敗不消耗」的要求。

**這條 SQL 是整個原子性保證的唯一承載者**,而 repo 沒有任何 DB-backed 測試(fake repository 測不到真 SQL)——因此它必須被**逐字 review**,不能只靠測試綠。

### 先後順序(初版未定義)

`claimed` 為空時有四種原因(不存在/過期/已用/已撤銷),需第二次查詢區分後回對應 error。「已是好友」的 idempotent 分支**必須在 claim 之前**判斷——先查 friendship 是否已存在,存在就直接回既有關係、**不執行上面那條語句**(否則會消耗一張邀請)。若 claim 成功但 `ON CONFLICT DO NOTHING` 沒插入(競態下另一條路徑剛建立),視為成功並回既有關係。

## 資訊揭露原則(貫穿本 sub-project)

- 好友列表、邀請預覽**只回 `displayName`**;`displayName` 為 null 時回 email 的 `@` 前綴(後端算好再回,前端不碰 email)。
- **結構性阻擋,不只是文字規則**:(a) repository 查詢**只列舉需要的欄位**,不 `select *` 整個 user;(b) application 對外的型別**根本沒有 email 欄位**,讓「不小心回出去」在型別層就編譯不過。
- 回應 payload **不含 `accepted_by_user_id`**(邀請人不需要知道 user id)。
- **刻意不記錄「誰預覽過連結」**——不加 `viewed_at`/瀏覽記錄。這是決策不是遺漏:預覽記錄會讓邀請人得知未接受者的存在,無使用價值卻多一個資訊面。
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
