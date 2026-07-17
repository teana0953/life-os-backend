# Tasks: add-walking-skeleton

## 1. 專案骨架

- [x] 1.1 初始化 npm 專案:TypeScript、Hono、wrangler、vitest、@cloudflare/vitest-pool-workers、jose、drizzle-orm、@neondatabase/serverless、drizzle-kit;`tsconfig.json`、`wrangler.toml`(secrets 用 binding 佔位,不含值)、`.gitignore`
- [x] 1.2 建立 hexagonal/context-first 目錄結構(`src/contexts/user/{domain,application,adapters}`、`src/shared/{auth,db}`、`src/adapters/http`、`test/`)
- [x] 1.3 撰寫 repo CLAUDE.md:架構慣例(domain 定義 port、adapters 實作、依賴只朝內、新 context 照 `contexts/user/` 樣板)、測試分層、命名慣例(技術前綴 + port 名)

## 2. Domain / Application(TDD,純單元測試)

- [x] 2.1 `User` entity 與 `UserRepository` port(interface):先寫測試再實作
- [x] 2.2 `get-or-create-user` use case:注入 in-memory repository,覆蓋「首次建檔」與「回頭客不重複建檔」兩情境(對應 user-account spec)

## 3. Shared 技術件(TDD,vitest-pool-workers)

- [x] 3.1 `firebase-verifier`:jose × JWKS 驗證;JWKS 來源設計為可注入(prod 用 createRemoteJWKSet、測試用 createLocalJWKSet,免攔 fetch),自產 RSA key 覆蓋:有效 token、過期、錯 aud、錯 iss、簽章無效、無/壞 header(對應 auth spec)
- [x] 3.2 Drizzle schema(`users` 表:id、firebase_uid unique、email、display_name、created_at)+ Neon client 工廠;產出第一份 drizzle-kit migration

## 4. Adapters

- [x] 4.1 `DrizzleUserRepository` 實作 `UserRepository` port(get-or-create by firebase_uid,回頭客不刷新 email/display_name)
- [x] 4.2 HTTP driving adapter:Hono app、auth middleware、`GET /health`(含 DB ping,DB 掛回 503)、`GET /api/me`、統一 `onError`(500 不洩內部訊息);測試注入 fake repository 驗 200/401/503 與 JSON 形狀(對應 api-platform + user-account spec)
- [x] 4.3 `index.ts` composition root:讀 env bindings(`DATABASE_URL`、`FIREBASE_PROJECT_ID`)手動 DI 組裝

## 5. 部署與驗收

- [ ] 5.1 對 Neon 跑 migration;`wrangler secret` 設定 `DATABASE_URL`、`FIREBASE_PROJECT_ID`;`wrangler dev` 本地驗證 `/health`
- [ ] 5.2 `wrangler deploy` 上線;線上驗收:`/health` 200、無 token `/api/me` 401、有效 Firebase token `/api/me` 回 user JSON 且 DB 有該筆資料
- [x] 5.3 README:專案簡介、本地開發、migration、secrets 設定、部署步驟
