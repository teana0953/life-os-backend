# Proposal: add-walking-skeleton

## Why

Life OS(個人生活作業系統)的所有後端模組都將建立在 Cloudflare Workers ↔ Neon PostgreSQL ↔ Firebase Auth 這條架構假設上,但目前 repo 是空的、假設未經驗證。需要一條最小可部署的 walking skeleton,end-to-end 打通三者,讓後續每個功能模組(健康、癌症照護、財務…)都踩在已驗證的地基上開發,Flutter 端也才有真實 API 可接。

## What Changes

- 建立 TypeScript + Hono 的 Cloudflare Workers 專案骨架(wrangler 設定、本地 `wrangler dev` 可跑)。
- 新增 Firebase ID token 驗證 middleware:以 `jose` 對 Google securetoken JWKS 驗簽並檢查 `aud`/`iss`(不使用 firebase-admin,Workers 不相容)。
- 建立 Neon 連線層:`@neondatabase/serverless` HTTP driver + Drizzle ORM,migration 由 drizzle-kit 管理。
- 新增最小資料模型:`users` 表(id、firebase_uid unique、email、display_name、created_at)。
- 新增兩個 endpoint:公開 `GET /health`(含 DB ping)、需登入 `GET /api/me`(首次呼叫依 token upsert user)。
- 以 Clean Architecture + DDD(hexagonal 命名、context-first 結構)組織程式碼,並將架構慣例明文寫入 repo 文件(CLAUDE.md)。
- 實際 `wrangler deploy` 上線;secrets(`DATABASE_URL`、`FIREBASE_PROJECT_ID`)以 `wrangler secret` 管理;部署步驟寫入 README。

## Capabilities

### New Capabilities

- `api-platform`: Workers 服務骨架與運維面——專案結構(hexagonal/context-first)、`GET /health` 健康檢查(含 DB ping)、統一錯誤處理、secrets 管理與部署流程。
- `auth`: Firebase ID token 驗證——JWT 驗簽(JWKS)、`aud`/`iss` 檢查、401 語意、受保護路由的存取控制。
- `user-account`: 使用者帳戶——首次登入自動建檔(upsert by firebase_uid)、`GET /api/me` 回傳個人資料。

### Modified Capabilities

(無——目前沒有既有 spec。)

## Impact

- **程式碼**:全新 repo 內容,`src/`(contexts/user、shared、adapters/http)、`drizzle/`、`test/`、`wrangler.toml`、CLAUDE.md、README。
- **外部依賴**:Cloudflare(Workers)、Neon(PostgreSQL)、Firebase(Auth);npm 依賴 hono、jose、drizzle-orm、@neondatabase/serverless、vitest、@cloudflare/vitest-pool-workers、wrangler、drizzle-kit。
- **系統**:部署後產生一個線上 Workers endpoint;Neon 內建立 `users` 表。
- **不影響**:R2、FCM、Gemini、Flutter(皆為後續 change)。
