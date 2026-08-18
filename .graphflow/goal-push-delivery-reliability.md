# 目標

讓提醒推播（a）真的送得到，以及（b）**後端知道它到底有沒有到**。

專案：life-os-backend —— Cloudflare Workers（Free 方案）+ Hono + drizzle-orm（neon-http）+ Neon Postgres，TypeScript。

## 這份 goal 是第二版：第一版被使用者在計畫核可 gate 駁回

第一版只做 TTL 與 `Urgency`。使用者的回覆是「**做真正的解法**」，並確認範圍是「**送達回執（含 TTL/Urgency）**」。

第一版的計畫自己已經指出了根本問題，那段論證是對的，照抄如下：

> RFC 8030 給 application server **沒有任何送達回執** —— push service 回的 201 是協定提供的唯一訊號，所以 `sent` 已經是後端所知範圍內最誠實的詞。真正的修法是 client 端的 ack（service worker 在 `push` 事件時 POST 回來）。

**這一版就是要做那件事。** 因此 `sent` 語意不再是「不要動」，而是本題的主體。

## 現況缺陷（我已查證，權威版本）

### A. 送達本身

`src/contexts/notifications/adapters/web-push-sender.ts`：

```ts
/** How long the push service should hold the message if the device is offline. */
const TTL_SECONDS = 60;
```

在 :124 以 `TTL: String(TTL_SECONDS)` 送出。`grep -rn "Urgency\|urgency" src/` **零命中**。

### B. 後端不知道有沒有送達

`web-push-sender.ts` 以 `response.ok` 判定 `{ outcome: "sent" }`。DB 裡每一筆 `care_occurrence.last_send_outcome` 都是 `sent`、`last_send_detail` 全空 —— 而使用者回報 2026-08-18 沒收到。**兩者不矛盾**，因為 `sent` 只代表 push service 收下了。

## 第一版已查證的事實（直接沿用，不要重查）

**RFC 8030 §5.3**（實際抓過 rfc-editor.org 與 datatracker）：
- `Urgency` 合法值只有 `very-low` / `low` / `normal` / `high` 四個小寫 token，其餘非法
- 沒送 `Urgency` 等同 `normal`
- `high` 那列的例子是「incoming call or **alert**」、對應裝置狀態「low battery」
- **push service MUST NOT 把 `Urgency` 轉給 user agent** —— 所以它不影響前端

**RFC 8030 §5.2**：「Once the TTL period elapses, the push service MUST NOT attempt to deliver the push message.」TTL=60 是硬性丟棄。

**未經查證、只能寫成推論**：`Urgency` 是否對應 FCM high-priority 或 Android Doze 豁免。找不到權威文件。**不准寫成事實。**

**caller 有三個**（第一版糾正過我）：`run-care-day.ts`、`send-test-push.ts`、以及 `src/contexts/finance/adapters/push-budget-alert-notifier.ts:24`（預算警示）。另有約 25 個測試假替身寫成 `pushSender: { send: notImplemented }`。任何 port 變更都不該讓它們壞掉。

## 現場資料（我查過 DB）

8 個啟用中的排程：08:00 nag=5、10:00 nag=15、21:30 nag=15；**09:00 / 09:30 / 12:00 / 18:30 / 20:00 這五個 nag=0**。

`run-care-day.ts:62-64`：`nagIntervalMinutes <= 0` 時 `nextDueAt` 回 `null` —— **射一次就沒了**。有設 nag 的三個，nag 確實在運作（`last_notified_at` 是最後一次 nag 的時間）。

兩筆 push subscription（07/24、07/29 建立），都是 FCM，都沒被判定 expired。使用者確認**測試推播收得到** —— VAPID、加密、service worker、通知顯示這條路是通的。

## 第一版計畫裡使用者沒有反對的部分（可沿用，但你仍要自己判斷）

- **TTL 依排程而異**：有 nag 的用 `nagIntervalMinutes × 60`，理由是下一次 nag 是同一 slot 的**替代**，TTL ≤ nag 間隔就得到不變式「push service 裡同一 slot 最多只有一份存活」，把 TTL 與 nag 的衝突解消而非折衷。`nag = 0` 與其他 caller 用一個較長的固定值（第一版提 1800s），上限的理由來自 repo 既有立場：`run-care-day.ts:9-20` 引 design.md gate_decision #2「遲到 25 分鐘的用藥提醒可能比沒收到更糟」。
- **送 `Urgency: high`**，理由只能引 RFC 的裝置狀態表，不得宣稱 Doze 效果。
- **測試推播保留 TTL 60**，語意是「現在按、現在收」。

**注意**：加入 ack 之後，「同一 slot 最多一份存活」這個不變式可能需要重新檢查——ack 會改變 nag 的觸發條件。**如果它不再成立，說出來，不要沿用一句已經失效的理由。**

## 本題真正的難點：service worker 要怎麼證明自己是誰

我已查證：`src/adapters/http/app.ts` 裡**每一個** `/api/*` 路由都掛 `authMiddleware`（Firebase ID token × Google JWKS），**沒有任何公開端點的先例**。

而 ack 要發生的時機，正是**使用者沒開著 app** 的時候 —— service worker 在 `push` 事件裡拿不到 Firebase ID token（那存在 client 端）。

**這是你必須解決的核心設計問題，不要繞過。** 可能的方向（不要照抄，自己評估）：

- payload 裡帶一個**每次送出隨機產生、單次有效**的 ack token，endpoint 不驗 Firebase token 只驗這個 —— 那就是一個 capability URL：要考慮長度/熵、有效期、重放、以及它會不會被記進日誌（**這個 repo 剛做完日誌遮蔽，PR #107**）
- SW 透過 `clients.matchAll()` 向開著的分頁要 token —— **但 app 關著時就是拿不到，而那正是要量的場景**
- 其他你想到的

**無論選哪個，都要說明：這個 endpoint 被亂打會發生什麼事。** 它是唯一一個不受 Firebase 保護的入口。

## 你要自己決定的（每一項都要說明取捨）

1. **ack 的認證方式。** 見上。這是最重要的一項。
2. **payload 要帶什麼。** 目前是 `{title, body}`（`messageBody(item)` 回 `item.dose ?? item.note ?? ""`，常常是空字串）。要帶 occurrence 識別、ack token…還有嗎？**Web Push payload 有大小上限，查證後說明。** 注意本專案的教訓：**客戶端讀不到的欄位就是下一次儲存刪掉的欄位** —— 不要預埋沒人讀的欄位。
3. **後端收到 ack 之後做什麼。** 最小是記錄「這則到了」。但要不要因此**停止 nag**？要不要在「送出但久久沒 ack」時**升級**（換一種送法、或至少在 app 裡標示）？**這會改到 `run-care-day.ts` 的 nag/retry 判斷，是本題最容易失控的地方。** 提方案並說明你把界線畫在哪、為什麼。
4. **資料要存哪。** `care_occurrence` 加欄位？另開一張表（多裝置各自 ack）？兩筆 subscription 代表可能有兩台裝置，**誰的 ack 算數？第一個到的？全部？** 說明。
5. **DB migration。** 目前最新是 `drizzle/0034_clean_red_ghost.sql`，流程是 `npm run db:generate` / `db:migrate`。migration 要能安全地套在**已有資料**的正式庫上。
6. **測試推播與預算警示要不要 ack。** 它們沒有 occurrence。
7. **前端那半怎麼交接。** 前端（`life-os` repo 的 `web/push_sw.js`）**不在這次範圍**。但後端先上而前端沒跟上時，系統會是什麼狀態？**「後端已備好、前端未做」不可以被描述成功能已完成。** 要明確寫出交接契約（endpoint、payload 形狀、SW 該做什麼），讓下一個 change 直接照著做。

## 不准做的事

**不可以在 PR、commit message 或報告裡宣稱這個改動修好了 2026-08-18 那則「沒收到通知」的回報。** 那個因果我證不出來 —— 而缺乏送達回執正是它證不出來的原因。要寫的是「送達可靠性的已知缺陷 + 建立送達事實」。

這個 repo 有「註解／說明比事實強」的前科，近期才因為引用了一句不存在的話被擋下。

## 驗證

- `npm run typecheck` 綠
- `npx vitest run --no-file-parallelism` 全綠 —— **基準是 134 檔 / 1585 條**（我已在這個 worktree 跑過未改動的版本）。改完回報實際數字；對不上就停下來說明
- 既有測試檔：`test/adapters/notifications/web-push-sender.test.ts`、`test/adapters/http/push.test.ts`、`test/contexts/notifications/application/run-care-day.test.ts`、`test/contexts/notifications/application/send-test-push.test.ts`
- **既有的 TTL 守門是 `expect(headers.get("TTL")).toBeTruthy()`（web-push-sender.test.ts:77）—— 它對任何值都成立，包括 60。** 這正是本 repo 反覆長出的「不可能失敗的守門」。修掉它。
- **每一項改動都要有能被突變殺死的守門**：
  - TTL 改回 60 → 紅
  - 拿掉 `Urgency` → 紅
  - 若 TTL 依排程而異：把兩個分支統一成同一個值 → 紅
  - ack endpoint：**用錯的／過期的／別人的 token 打進來必須被拒絕**，把那個檢查拿掉 → 紅。**這條是本題的 LINCHPIN** —— 它是唯一不受 Firebase 保護的入口
  - ack 寫入後，該筆 occurrence 的送達狀態確實改變 → 把寫入拿掉 → 紅
- 守門要斷言**實際送出的 HTTP 請求**（`WebPushSenderOptions.fetchImpl` 可注入），不是斷言常數的值
- **假替身不會拒絕真 API 拒絕的東西**：本專案有「提醒功能上線後一封都沒送出過、1400+ 條測試全綠」的事故。ack endpoint 的測試若只走假 client，要明說哪些部分**只有實機才驗得到**，不要宣稱已驗證

## 專案規範

- 遵守 repo 根的 CLAUDE.md 與 life-os-backend/CLAUDE.md：Clean Architecture 依賴規則（`application/` 不可 import `adapters/` 或 `shared/`；純邏輯放 `shared-kernel/`）、以及 **Comments 一節**（預設不寫；要寫就寫程式碼說不出的東西，每個數字都要有來源）
- **現有那句 TTL 註解**只複述了它是什麼、沒說為什麼是 60。新的值必須有理由，而理由要寫下來
- **surgical**：不要重構 nag/retry 以外沒必要動的部分、不要動前端 repo、不要順手改其他 route
- 這個 repo 反覆長出「不可能失敗的守門」。每寫一條守門就突變確認；任何「某文件／RFC 說了什麼」的敘述都要自己看原文
