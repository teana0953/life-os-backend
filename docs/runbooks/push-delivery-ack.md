# Runbook — 推播送達回執(`push_delivery`)

## 這張表在說什麼

`push_delivery` 一列 = 一次「嘗試送給一台裝置」,而且是**送出之前**就寫下的
(ack 可能在同一輪就回來)。送失敗的也留一列,包含根本沒發出 HTTP 請求的情況
(`no_vapid_config`、`crypto:*`)。所以 `count(*)` 是嘗試數、不是送達數,拿它
當分母算出來的送達率會**低估**。`acked_at` 是這個資料庫裡
**唯一**能證明裝置真的收到的欄位;push service 回 201 只代表它收下了。

**`acked_at IS NULL` 代表「沒有人回報」,不代表「沒送到」。** 看到一片 NULL
時,至少有三個來源,盯著這張表下結論之前要先排除後兩個:

1. **前端 `web/push_sw.js` 的 ack 還沒上線** —— 在那之前整張表都是 NULL,
   不要拿它算送達率。
2. **舊註冊還沒換到帶 API base URL query 的 script URL(上線之後最主要的來
   源)。** 前端把 API base URL 放在 service worker 的 script URL query 上
   (參數名以前端 `pushSwScriptUrl()` 與 `web/push_sw.js` 為準,兩邊由
   `test/shared/pwa/push_sw_ack_contract_test.dart` 守著,別在這裡另抄一份字
   面值);這次改動**之前**建立的註冊,script URL 是**完全沒有 query** 的。瀏
   覽器定期的更新檢查抓的是**同一個 URL**,所以那些裝置會拿到新的 worker
   **程式碼**、卻永遠讀不到那個參數,ack 端點解析成 null、什麼都不送。URL 只
   有在前端重新跑一次 `register()` 時才會換,而 `PushHealthController` 的抑制
   窗只擋掉「上次同步成功、且距今未滿一小時」的重跑
   (`push_health_controller.dart` 的 `!force && health == ok &&
   _lastSyncAt != null`)。**淨結果:既有裝置是一台一台、各自從下次冷啟(或
   距上次成功同步超過一小時的暖回前景;處於 `syncFailed` 的裝置則完全不被抑
   制)起才開始回報**,所以上線後會有一段回報率慢慢爬升的期間 —— 那是註冊在
   換,不是送達率在動。
3. **worker 更新交接的空窗(每次更新一次,很窄)。** 新舊 worker 交接時,瀏覽
   器把 push 派給**當下 active 的那一個**,可能還是舊的、不會 ack 的 worker。
   這在頁面端修不了(等待新 worker 啟用並不會改變瀏覽器把這則 push 派給誰),
   屬於已知殘餘,不是待辦。

第 2、3 點的機制記在前端
`lib/contexts/notifications/infrastructure/browser_web_push_gateway.dart` 的
類別註解。方向是單向的:**有 `acked_at` 就一定送到了;NULL 推不出沒送到。**

## 常用查詢

某一天每個 occurrence 有沒有被任何裝置回報收到:

```sql
select o.local_date, o.time_of_day, o.last_send_outcome,
       exists (select 1 from push_delivery d
                where d.care_occurrence_id = o.id and d.acked_at is not null) as acked
  from care_occurrence o
 where o.local_date = '2026-08-18'
 order by o.time_of_day;
```

逐裝置(哪一台收到、哪一台沒有):

```sql
select d.push_subscription_id, d.sent_at, d.expires_at, d.acked_at
  from push_delivery d
 where d.care_occurrence_id = '<occurrence-id>';
```

`push_subscription_id IS NULL` 代表該訂閱事後被刪除(通常是 410 之後重裝),
那一列仍然是一次真實的送出,`acked_at` 依然可信。

`token_hash` 是 sha256,不可逆;查詢與診斷都不需要明文 token,也拿不到。

## `POST /api/push/ack` 被灌爆時

這是 `/api/*` 底下唯一沒有 `authMiddleware` 的路由。它擋不住流量,只擋得住
「做無謂的 DB 工作」:格式不合(非 43 字元 base64url)一律直接回 204、完全不碰
DB;`Content-Length` 宣告超過 1 KB 的 body 連讀都不讀就回 204(沒宣告或少報的,
讀進來之後、解析之前擋掉);命中時只有一句 `UPDATE`。

真正的風險不是資料外洩(token 256 bit、回應恆為 204、成功的 ack 也只改得動一
列的 `acked_at`),而是**把 Neon compute 額度燒掉** —— 本專案已經因為每分鐘的
cron 撞過一次月中額度上限。

處理順序:

1. 先看 Cloudflare 的 request log,確認流量集中在 `/api/push/ack`。
2. 在 Cloudflare 上對這條路徑加 **WAF rate limiting**。這是操作面的槓桿,程式
   碼裡刻意不預先寫限流。
3. 確認 Neon 的 compute 用量是否已經受影響(見
   `lifeos-neon-compute-budget` 的門檻)。

沒有需要輪替的祕密:每個 token 都是一次性的、只存 hash,而且過了該則訊息的
TTL 就再也不會被接受。
