# 功能 C 目標與成就 dashboard — 拆解底稿

> 承 [chaodays → LifeOS 功能轉化底稿](./chaodays-to-lifeos-features.md) 的功能 C。
> A(運動)、B(生理期)已 shipped。本文把 C 拆成可獨立出貨的小 change。
> 日期:2026-07-22。

## 一、關鍵發現:C 有一部分已經做好了

盤點現況後,C 比想像小很多——「每日剩餘份量預算」這塊**已完成**,其餘多是**在既有資料上的呈現/聚合層** + 幾個新概念。

| C 的子塊 | 現況 | 結論 |
|---|---|---|
| **每日剩餘份量預算**(六大類吃一餐扣一餐) | ✅ **已完成** 後端 `getDailyTargetWithRemaining`(base/bonus/effective/logged/**remaining**)+ 前端「今日」tab category progress、「目標」tab 可設 | 不用做;dashboard 直接再呈現即可 |
| **記錄月曆(哪天有填)** | 🟡 後端 `getLoggedDays`(**僅 meals/飲食**)已存在;前端 diet 月曆已用 | 擴充成跨 tracker + 加達標率環 |
| **體重/體脂資料** | 🟡 vitals 已存 weightKg/bodyFatPct(**僅逐日 GET**) | 加 range 查詢 |
| **血壓/心跳/血氧/血糖資料** | 🟡 vitals 已存(jsonb readings 陣列,**僅逐日 GET**) | 加 range 查詢(趨勢圖用) |
| **運動 → 加食量**的加成欄位 | ✅ **`bonus` 機制已在** daily-target(effective = base + bonus) | 聯動只差「寫入 bonus」的邏輯 |
| 目標體重 / 達成率 | ❌ 無(user profile 無 height/target weight/goal) | 新增「目標」概念 |
| 達標率成就環(填寫率/達標率/達成率) | ❌ 無聚合計算 | 新增 |
| 圖表庫(趨勢圖用) | ❌ pubspec 無 fl_chart 等 | 需加依賴或自繪 |
| 聚合「資訊總覽」surface | ❌ 無 | 新增 dashboard 畫面 |

## 二、拆成 5 個獨立 change(每個 backend + frontend,照 A/B 節奏)

### C1 — 身體資料(身高 + 目標體重)+ 達成率 + BMI ⭐建議先做
- **新概念:身體資料(body profile)** —— 相對靜態、非每日追蹤器,對齊 chaodays「會員資料驅動目標計算」:
  - **身高 heightCm**(靜態,BMI 與未來份量自動計算要用)
  - **目標體重 targetWeightKg**
  - (生理性別 delay 到「份量自動計算」才需要,C1 不做)
- **後端**:set/get 身體資料;overview 端點回 `{ heightCm, targetWeightKg, currentWeightKg(取 vitals 最近一筆), remainingKg, achievementRate, bmi }`。
- **前端**:dashboard **目標卡**「目標 / 今日 / 剩餘」三欄 + 環形達成率 + **BMI**(chaodays 招牌卡);點卡片 → 設定身高與目標體重(也可日後放設定頁)。
- **依賴**:vitals 最近體重(已有逐日;可能要「最近一筆」查詢)。self-contained、價值高、引入 body-profile/goal 概念。
- **順帶**:C1 前端一併立起「總覽 hub」的殼(見 UX 分析——落地頁改總覽),目標卡是第一張卡。

### C2 — 健康數值趨勢圖(體重/體脂 + 血壓/心跳/血氧/血糖)
- **後端**:vitals **range 查詢**(`GET /api/vitals/range?from=&to=` → 各指標時間序列;weight/bodyFat scalars + bp{systolic,diastolic,pulse}/spo2{spo2,pulse}/glucose{value} readings 攤平成序列)。
- **前端**:折線圖,指標可切換(體重/體脂/收縮壓/舒張壓/心跳/血氧/血糖),區間 7/30/90 天。**需加圖表庫**(建議 fl_chart)或自繪。理想:可疊生理期(B 資料)。
- **依賴**:vitals range(新)。範圍最大的一塊(多指標 + 圖表庫)。

### C3 — 記錄月曆 + 達標率成就
- **後端**:擴充/新增「本月哪些天有記錄」(跨 tracker:飲食/體重…)+ 達標率聚合(本月體重填寫率、飲食達標率、體重達成率)。
- **前端**:月曆圓點(哪天有填)+ 三個環形指標。可複用既有月曆繪製 + menstrual 的 legend/semantics pattern。
- **依賴**:logged-days(擴充)、C1 的達成率。

### C4 — 運動 ↔ 食量聯動
- **後端**:記錄運動時,依運動類型/時長算出加成份量,**寫入當日 daily-target 的 `bonus`**(effective 已 = base + bonus,remaining 會自動反映)。要定義換算(運動→份量)。
- **前端**:極小(「今日」/「目標」tab 顯示 bonus 加成即可;bonus 已在 DailyTargetWithRemaining)。
- **依賴**:daily-target bonus(已有)、exercise(A,已有)。這是 A 當初刻意延後的聯動。

### C0 — 資訊總覽 dashboard(聚合 surface)
- C1–C3 的卡片要有個家。**放哪裡是待決策**(見下)。可先做空殼再逐張加卡,或每張卡先掛在既有畫面、最後再聚合。

## 三、兩個待你決策

### 決策 1:dashboard 放哪?
- **A. 進「更多」新增「總覽」入口**(最一致、最小;之後可升級成 hub)——與現有 4 tab+更多 導覽一致。
- **B. 把「今日」tab 改成 hub 儀表板**(chaodays 式落地頁;改動大、動到既有主畫面)。
- **C. 卡片分散掛既有畫面**(目標卡上「今日」、趨勢圖進 vitals/更多…;無單一總覽)。
> 傾向 **A**(先做總覽入口,日後要 hub 再演進),與當初導覽決策一致。

### 決策 2:先做哪個?
> 傾向 **C1(目標體重+達成率)**:最 self-contained、引入 goal 概念、是招牌卡。之後 C2 趨勢圖 → C3 月曆+達標率 → C4 聯動。

## 四、明確延後 / 範圍外
- AI 貼心提醒、教練層(方案/訂單/預約/社群)—— 一律範圍外(見主底稿)。
- 趨勢圖疊生理期可列 C2 選配,不強求 v1。
