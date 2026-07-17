# Proposal: add-cicd

## Why

Walking skeleton 已合併但尚未實際部署,且沒有任何自動化品質關卡——每次改動都得手動跑測試與 `wrangler deploy`,容易漏、也讓密鑰得在本地與雲端各設一次。建立 GitHub Actions pipeline 可自動守門(PR 跑測試)並自動交付(merge 後部署),同時完成骨架遞延的「實際部署 + 線上驗收」。

## What Changes

- 新增 CI workflow(`.github/workflows/ci.yml`):`pull_request` 與非 main 分支 `push` 時跑 `npm run typecheck` + `npm test`。
- 新增 CD workflow(`.github/workflows/deploy.yml`):`push` 到 `main` 時跑 migration → 部署 Cloudflare Workers → 線上煙霧測試。
- runtime secrets 單一來源設在 GitHub:CD 每次部署透過 `cloudflare/wrangler-action` 把 `DATABASE_URL`、`FIREBASE_PROJECT_ID` 推送到 Worker,免在 Cloudflare 手動設定。
- 部署後煙霧測試:`GET /health` 期望 200、`GET /api/me` 無 token 期望 401。
- 引入 `actionlint` 靜態檢查 workflow;README 補 CI/CD 章節與所需 GitHub secrets 清單。

## Capabilities

### New Capabilities

- `ci-cd`: 持續整合與交付——PR/push 的自動測試守門、merge 到 main 的自動 migration 與部署、部署後線上煙霧測試、runtime secrets 以 GitHub 為單一來源推送到 Worker。

### Modified Capabilities

(無 spec 層行為變更——api-platform/auth/user-account 的需求不變,本 change 只加交付機制。)

## Impact

- **新增檔案**:`.github/workflows/{ci,deploy}.yml`、README CI/CD 章節。
- **外部設定**:GitHub repo secrets(`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`DATABASE_URL`、`FIREBASE_PROJECT_ID`),由使用者於 GitHub UI 設定。
- **依賴**:CI 使用 `actions/setup-node`、`cloudflare/wrangler-action`;dev 依賴新增 `actionlint`(或以容器/action 執行)。
- **不影響**:應用程式碼(`src/`)、既有測試、其他 repo。首次成功 CD 後產生線上 Worker 並套用 `users` 表 migration。
