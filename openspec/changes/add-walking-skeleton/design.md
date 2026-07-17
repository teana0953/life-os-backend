# Walking Skeleton — Life OS 後端骨架

## 目標

在 `life-os-backend` 建立可部署的最小後端骨架,end-to-end 驗證 draft.md 的核心架構假設:
**Cloudflare Workers ↔ Neon PostgreSQL ↔ Firebase Auth** 三者能順利接起來。

完成後,Flutter 端(`life-os` repo)即可另起 loop 接上這條骨架。

## 範圍

### 包含

1. **Workers 專案骨架**:TypeScript + Hono,wrangler 設定,本地 `wrangler dev` 可跑。
2. **Firebase Auth 驗證 middleware**:驗 Firebase ID token(JWT),透過 `jose` 對 Google
   securetoken JWKS 驗簽 + 檢查 `aud`/`iss` 為本專案。**不用 firebase-admin**(Workers 不相容)。
3. **Neon 連線**:`@neondatabase/serverless`(HTTP driver)+ Drizzle ORM,
   migration 用 drizzle-kit 管理。
4. **最小資料模型**:`users` 表(id, firebase_uid unique, email, display_name, created_at)。
5. **兩個 endpoint**:
   - `GET /health` — 公開,回 `{ ok: true }`(含 DB ping)。
   - `GET /api/me` — 需登入;首次呼叫依 token 內容 upsert user,回傳 user JSON。
6. **實際部署**:`wrangler deploy` 上線,secrets(`DATABASE_URL`、`FIREBASE_PROJECT_ID`)
   用 `wrangler secret` 管理;部署步驟寫進 README。
7. **架構慣例文件**:hexagonal 分層規則、依賴方向、新 context 樣板寫進 repo 的
   CLAUDE.md(或 openspec `project.md`),供後續所有開發(含 AI agent)遵循。

### 不包含(之後的 loop)

R2 上傳、FCM、Gemini、任何業務模組(健康/財務/庫存…)、Flutter 端、rate limiting。

## 架構:Clean Architecture + DDD(hexagonal 命名)

```
Flutter (未來) ──HTTPS──▶ Workers (Hono, driving adapter)
                            ├─ authMiddleware: jose × Google JWKS (shared 技術件)
                            ├─ use cases (application 層, inbound port)
                            └─ UserRepository port ◀─ DrizzleUserRepository (driven adapter) ──▶ Neon
```

**依賴規則**:domain 不 import 任何外層;application 只依賴 domain 與 port(interface);
adapters 實作 port;composition root(`index.ts`)手動 DI 組裝——不引入 DI 框架。
**術語採 hexagonal(ports & adapters)**,全 repo 一致,不與 infrastructure 混用;
架構慣例須明文寫入 repo 文件(CLAUDE.md / openspec project.md),供後續所有 agent 遵循。

**Bounded context**:採 **context-first** 結構——上層按 context 分,context 內再分層。
骨架先立 `user` context(唯一聚合:User);未來模組各成 context
(health、cancer-care、finance、inventory、travel、documents)套同一套內部分層,
要拆獨立服務時整個 context 資料夾搬走即可。
骨架階段戰術模式保持輕量:entity + repository port 即可,不做 domain event / factory
(YAGNI,等有第二個聚合再說)。

專案結構:

```
src/
  contexts/
    user/
      domain/
        user.ts                    # User entity
        user-repository.ts         # port (interface)
      application/
        get-or-create-user.ts      # use case
      adapters/
        drizzle-user-repository.ts # driven adapter(port 實作)
  shared/
    auth/
      firebase-verifier.ts         # jose × JWKS(跨 context 技術件)
    db/
      schema.ts                    # Drizzle schema
      client.ts                    # Neon 連線工廠
  adapters/
    http/                          # driving adapter(薄:組裝與轉譯)
      app.ts                       # Hono app、onError
      middleware/auth.ts
      routes/health.ts
      routes/me.ts
  index.ts                         # composition root(DI 組裝 + export)
drizzle/                           # migrations
test/
wrangler.toml
```

類別命名慣例:driven adapter 用「技術前綴 + port 名」(`DrizzleUserRepository`),
不用 `~Adapter` 後綴。

## 技術選型與理由

| 項目 | 選擇 | 理由 |
|---|---|---|
| Framework | Hono | Workers 原生、輕、生態主流 |
| DB driver | @neondatabase/serverless | Workers 只能走 HTTP/WebSocket,傳統 pg 接不上 |
| ORM | Drizzle | 對 serverless driver 支援最好、migration 工具內建;骨架只有一張表,若不喜歡换掉成本低 |
| JWT 驗證 | jose | firebase-admin 依賴 Node API,Workers 不可用 |
| 測試 | vitest + @cloudflare/vitest-pool-workers | 官方 Workers 測試方案,在 workerd runtime 內跑測試 |

## 錯誤處理

- 無/壞 token → 401 `{ error: "unauthorized" }`;DB 失敗 → 500 `{ error: "internal" }`(不洩內部訊息)。
- 統一 error handler(Hono `onError`)。

## 測試策略(gate)

- **domain / application 層**:純 TS 單元測試,use case 注入 in-memory UserRepository,
  不碰 Workers runtime,最快最穩。
- **infrastructure / interface 層(vitest-pool-workers)**:
  - firebase-verifier:自產 RSA key + mock JWKS fetch,覆蓋有效 token、過期、錯 aud、無 token。
  - HTTP routes:組裝 app 時注入 fake repository,驗 401/200 路徑與 JSON 形狀。
- **部署驗收(手動/QA phase)**:deploy 後打真 endpoint——`/health` 200;
  真 Firebase token 打 `/api/me` 得 user JSON;無 token 得 401。
- gate_cmds(預計):`npm test`、`npx tsc --noEmit`。

## 驗收標準

1. `npm test` 與 typecheck 全綠。
2. `wrangler dev` 本地可跑,`/health` 回 200 且 DB ping 成功。
3. 部署後線上 `/health` 200;帶有效 Firebase token 的 `/api/me` 回傳 user 且 DB 有該筆資料;無效 token 401。
