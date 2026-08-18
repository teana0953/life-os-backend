# Runbook — 推播送達回執(`push_delivery`)

## 這張表在說什麼

`push_delivery` 一列 = 一次「嘗試送給一台裝置」,而且是**送出之前**就寫下的
(ack 可能在同一輪就回來)。送失敗的也留一列,包含根本沒發出 HTTP 請求的情況
(`no_vapid_config`、`crypto:*`)。所以 `count(*)` 是嘗試數、不是送達數,拿它
當分母算出來的送達率會**低估**。`acked_at` 是這個資料庫裡
**唯一**能證明裝置真的收到的欄位;push service 回 201 只代表它收下了。

**前端 `web/push_sw.js` 上線前,`acked_at` 全部是 `NULL`,而那代表「沒有人回
報」,不代表「沒送到」。** 在那之前不要拿這張表下送達率的結論。

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
