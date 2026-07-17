# Tasks: add-cicd

## 1. Gate 工具

- [x] 1.1 加入 `actionlint` 到 gate:package.json 新增 `lint:actions` script(用 npx 或下載 binary 執行 actionlint 掃 `.github/workflows/`);確認本地可跑

## 2. CI workflow

- [x] 2.1 `.github/workflows/ci.yml`:觸發 `pull_request` + 非 main 分支 `push`;加 `concurrency`(group 依 ref、`cancel-in-progress: true`)避免同分支重複 run;job = checkout → setup-node(v22, npm cache)→ `npm ci` → `npm run typecheck` → `npm test`(對應 ci-cd「Continuous integration」需求)

## 3. CD workflow

- [ ] 3.1 `.github/workflows/deploy.yml`:觸發 `push` 到 `main`;步驟 checkout → setup-node → `npm ci`
- [ ] 3.2 migration 步驟:`npm run db:migrate`,`DATABASE_URL` 取自 `secrets.DATABASE_URL`;失敗即中止後續(對應「Migration failure aborts deploy」)
- [ ] 3.3 deploy 步驟:`cloudflare/wrangler-action`,`apiToken`/`accountId` 取自 secrets;以 action 的 `secrets:` 輸入列出 `DATABASE_URL`、`FIREBASE_PROJECT_ID`,**並在同 step 的 `env:` 把這兩個從 `${{ secrets.* }}` 映射進來**(wrangler-action 由 env 讀真值上傳),否則 smoke test 會因 Worker 缺 secret 而紅(對應「Runtime secrets sourced from CI」)
- [ ] 3.4 煙霧測試步驟:部署 URL 來源先定案——優先用固定 production 網址(以 repo 變數 `PRODUCTION_URL` 或 `life-os-backend.<subdomain>.workers.dev` 帶入),不倚賴 wrangler-action 可能回 preview URL 的 output;curl `GET /health` 斷言 200、`GET /api/me` 無 token 斷言 401,任一不符則 job 失敗(對應「Post-deploy smoke test」)

## 4. 文件

- [ ] 4.1 README 補 CI/CD 章節:pipeline 行為、所需 4 個 GitHub secrets 與設定位置、部署失敗無自動 rollback 的處理說明

## 5. 靜態驗證

- [ ] 5.1 對兩個 workflow 跑 `actionlint` 通過;確認 `npm test`、`npm run typecheck` 維持全綠(gate 全綠)
