# Runbook — 設定 VAPID 推播密鑰(3 個 secret)

lifeos 後端的 Web Push(提醒推播)需要三個環境變數:

| 名稱 | 是什麼 | 機密? |
|---|---|---|
| `VAPID_PUBLIC_KEY` | 應用伺服器公鑰,base64url 的 65-byte 未壓縮 P-256 點 | 否(前端訂閱時會拿到)|
| `VAPID_PRIVATE_KEY` | 對應私鑰,base64url 的 32-byte scalar | **是,絕不外洩/入版控** |
| `VAPID_SUBJECT` | JWT `sub`,一個 `mailto:` | 否 |

> ⚠️ **三個都要設,尤其 `VAPID_SUBJECT`。** 沒設的話 `sub` 會是空字串,FCM/Apple 會**拒收**,而後端的假 fetch 測試抓不到 → 變成「測試全過但手機收不到」。

---

## 步驟 1 — 產生金鑰(在你自己的終端機跑,私鑰不要貼給任何人)

在 `life-os-backend/` 目錄:

```sh
npx web-push generate-vapid-keys
```

輸出長這樣:

```
=======================================
Public Key:
BFx...（約 87 字元 base64url)
Private Key:
k3z...（約 43 字元 base64url)
=======================================
```

這個格式跟後端 `WebPushSender` 期望的完全一致(公鑰=未壓縮點、私鑰=raw scalar),不用再轉換。
**把這兩個字串記下來**,下面兩處會用到。Private Key 只給機器設定用,別貼進聊天/commit/截圖。

---

## 步驟 2 — 設到「已部署的 Worker」(正式環境)

Worker 名稱是 `life-os-backend`(見 `wrangler.toml`)。兩種方式擇一。

### 方式 A:wrangler(需先 `wrangler login` 或設 `CLOUDFLARE_API_TOKEN`)

```sh
# 每一條會提示你貼上值(輸入不會顯示),貼完 Enter
npx wrangler secret put VAPID_PUBLIC_KEY     # 貼步驟 1 的 Public Key
npx wrangler secret put VAPID_PRIVATE_KEY    # 貼步驟 1 的 Private Key
npx wrangler secret put VAPID_SUBJECT        # 輸入 mailto:teana0953@gmail.com
```

確認已設(只列名稱、不顯示值):

```sh
npx wrangler secret list
```

### 方式 B:Cloudflare Dashboard(不用本機 wrangler 登入)

1. Cloudflare Dashboard → **Workers & Pages** → **life-os-backend** → **Settings** → **Variables and Secrets**。
2. **Add** 三筆,**Type 都選 Secret(加密)**:
   - `VAPID_PUBLIC_KEY` = 步驟 1 的 Public Key
   - `VAPID_PRIVATE_KEY` = 步驟 1 的 Private Key
   - `VAPID_SUBJECT` = `mailto:teana0953@gmail.com`
3. **Save / Deploy**。

> secret 設好後即時生效,不必為了它重新部署;但要注意讀取這些變數的程式碼(PR #34)得先合併並部署,變數才會被用到。順序不拘——變數可以先放著等程式碼上線。

---

## 步驟 3 — 設到「本機開發」(選用,`wrangler dev` 用)

在 `life-os-backend/.dev.vars`(此檔已 gitignore,不會進版控)加三行:

```
VAPID_PUBLIC_KEY=步驟1的PublicKey
VAPID_PRIVATE_KEY=步驟1的PrivateKey
VAPID_SUBJECT=mailto:teana0953@gmail.com
```

(欄位名稱可對照 `.dev.vars.example`。)

---

## 步驟 4 — 驗證

部署後,帶著你的 lifeos 登入 token 打:

```sh
curl -H "Authorization: Bearer <你的_firebase_id_token>" \
  https://<你的-worker-網址>/api/push/vapid-public-key
# 預期:{"public_key":"BFx...（跟步驟1的 Public Key 相同)"}
```

回傳的 `public_key` 應等於步驟 1 的 Public Key。真正的「手機收到測試推播」要等 **Slice 1b(前端)** 做好按鈕後,在 iOS(加到主畫面)/Android 上驗。

---

## 注意事項

- **同一把公鑰前端會再用一次**:Slice 1b 的訂閱流程會呼叫 `GET /api/push/vapid-public-key` 拿這把公鑰去 `subscribe`。前後端必須是**同一組金鑰**,所以整個 app 只產一次、之後固定。
- **私鑰外洩的話**:換一組金鑰(重跑步驟 1、重設 secret)。換金鑰會讓「舊公鑰建立的既有訂閱」失效,使用者需重新訂閱。
- **不要**把私鑰寫進 `wrangler.toml`、程式碼、或任何入版控的檔案。
