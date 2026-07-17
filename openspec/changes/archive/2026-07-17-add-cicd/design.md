# add-cicd — GitHub Actions CI/CD

## 目標

為 `life-os-backend` 建立 GitHub Actions pipeline:PR/push 跑 CI(測試+型別檢查),
merge 到 main 後自動 CD(migration + 部署到 Cloudflare Workers + 線上煙霧測試)。
同時完成 walking skeleton 遞延下來的「實際部署 + 線上驗收」。

## 範圍

### 包含

1. **CI workflow**(`.github/workflows/ci.yml`):
   - 觸發:`pull_request` + `push`(main 以外分支)。
   - 步驟:checkout → setup-node(v22, npm cache)→ `npm ci` → `npm run typecheck` → `npm test`。
2. **CD workflow**(`.github/workflows/deploy.yml`):
   - 觸發:`push` 到 `main`。
   - 步驟:checkout → setup-node → `npm ci` → **migration**(`npm run db:migrate`,`DATABASE_URL` 來自 GitHub secret)
     → **deploy**(`cloudflare/wrangler-action`,同時上傳 runtime secrets)→ **smoke test**。
3. **Runtime secrets 單一來源 = GitHub**:CD 每次部署用 wrangler-action 的 `secrets` 輸入,
   把 `DATABASE_URL`、`FIREBASE_PROJECT_ID` 從 GitHub secrets 推到 Worker,
   不需要在 Cloudflare 另外手動 `wrangler secret put`。
4. **線上煙霧測試**:部署後 curl 已上線 endpoint——`GET /health` 期望 200、
   `GET /api/me` 無 token 期望 401。任一失敗 → CD job 失敗。
5. **Workflow 靜態驗證**:引入 `actionlint` 作為本 change 的 gate 之一(catch YAML/表達式錯誤)。
6. **README 補 CI/CD 章節**:所需 GitHub secrets 清單與設定位置、pipeline 行為說明、
   徽章(badge)可選。

### 不包含

- 多環境(staging/preview):先只做單一 production。需要時另開 change。
- Flutter 端 CI、其他 repo 的 pipeline。
- 端到端「有效 Firebase token 拿 user JSON」的線上驗證(需真實登入用戶簽出的 token,
  待 Flutter 端能產 token 時再補;煙霧測試只驗 401 守衛與 /health)。

## 所需 GitHub Secrets(使用者於 GitHub UI 設定,永不經過對話)

| Secret | 用途 | 取得 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | 部署權限 | Cloudflare dashboard → API Tokens → "Edit Cloudflare Workers" 模板 |
| `CLOUDFLARE_ACCOUNT_ID` | 帳號識別 | Workers 頁面右側 / `wrangler whoami` |
| `DATABASE_URL` | migration + Worker runtime | Neon connection string(含 `?sslmode=require`) |
| `FIREBASE_PROJECT_ID` | Worker runtime(token 驗證) | Firebase console → 專案設定 |

> `CLOUDFLARE_ACCOUNT_ID` 與 `FIREBASE_PROJECT_ID` 非機密,但一併放 GitHub secrets 統一管理。

## 架構決策

- **CI 與 CD 分兩個 workflow 檔**:關注點分離、觸發條件互不干擾、CD 失敗不影響 CI 徽章。
- **migration 每次部署都跑**:`drizzle-kit migrate` 以 migration 檔追蹤已套用項,idempotent,
  安全;確保 schema 與程式碼原子上線。
- **runtime secrets 由 CD 推送(單一來源 GitHub)**:避免密鑰在 Cloudflare 與 GitHub 兩地各設一次、
  避免漂移;`drizzle.config.ts` 已優先讀 `process.env.DATABASE_URL`,CI 環境變數即可直接生效。
- **不用 OIDC / 不存長期憑證於 repo**:僅用 GitHub encrypted secrets。

## 錯誤處理 / 邊界

- 缺任一 secret → CD job 在對應步驟失敗並明確報錯(不會半部署)。
- migration 失敗 → 不進行 deploy(步驟順序保證)。
- 煙霧測試失敗 → job 標紅,但**程式已部署**(Workers 無自動 rollback);README 註明需人工處理或回滾 commit。

## 測試 / 驗收

- **gate(本 change)**:`actionlint`(workflow 靜態檢查)+ 既有 `npm test`、`npm run typecheck`(維持全綠)。
- **QA / 端到端(需使用者先設好 GitHub secrets)**:
  1. 推一條測試分支 → 觀察 CI run 綠(`gh run watch`)。
  2. merge PR/推 main → 觀察 CD run:migration 成功、deploy 成功、煙霧測試 `/health` 200 + `/api/me` 401 綠。
- **驗收標準**:CI 在 PR 上自動跑且會擋紅;push main 後 Worker 實際上線且 `/health` 線上回 200、
  `/api/me` 無 token 回 401。
