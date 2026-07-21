# 设计草稿:家常量单位纳入 base measure(generalize-measure-unit-household)

## 目标 / 背景

延续 #13。`base_amount` + `measure_unit` 让食物能做 `quantity = measure ÷ base_amount` 换算,但只对 g/ml 生效。271 条食物里 **195 条家常量单位**(顆/碗/杯/片/個…)的两栏都是 null,因为 `parseBaseMeasure` 只认 g/克/ml/毫升/cc。结果「櫻桃/9顆」的「1 份 = 9 顆」这个「9」没被结构化存下来,只在名字字符串里、parse 阶段丢弃。前端因此:consumed 显示「1 顆」(实际 1 份=9 顆)、家常量发 `measure` 被 `NullBaseMeasureError`→400 无法直接输入颗数、份数模式单位词硬抠名字很怪。

**做**:把可数量词(顆/碗/杯/片…)也纳入 base measure,与 g/ml 完全对称。**纯后端;前端另开 PR 跟。破坏性(enum→text + reseed),单用户可无痛重建 dev DB。**

## 核心决策

### D1. `measure_unit` 从 pgEnum('g','ml') → text(开放单位字)

`food_item` 和 `meal_item` 的 `measure_unit`:`pgEnum` 改成 **`text`**,存 `'g'` / `'ml'` / 任意量词字(`'顆'`/`'碗'`/`'杯'`…)。drizzle migration:enum 列 → text 列(现有 g/ml 值原样保留)。domain 类型 `"g"|"ml"` → `string`。**both-or-null 不变量保留**(base_amount 与 measure_unit 一致存在/一致 null)。

> 为什么 text 而非扩充 enum:家常量单位是开放集合(數據里已有 個/顆/碗/片/杯/條/隻/根/湯匙/球/圈/截…十余种,未来还会加),enum 每加一种要迁移,不可持续。text + seed 期白名单校验即可。

### D2. `parseBaseMeasure` 通用化:白名单量词 + 锚定斜线紧邻

保留现有 g/ml 归一(g/克→'g';ml/mL/毫升/cc→'ml'),**新增白名单量词 pattern**。三者都锚定 `/\/\s*(\d+(?:\.\d+)?)\s*(单位)/`——**斜线紧邻数字紧邻单位**,这是安全关键:

- **白名单量词**(数据驱动,只列 TSV 实际出现的清晰量词,YAGNI 不放前瞻项):`個 顆 碗 片 杯 條 隻 根 湯匙 球 圈 截`。量词保留原字(不过度归一,`個`≠`顆` 不合并)。
- **归一**:g/克→`'g'`;ml/mL/毫升/cc→`'ml'`;白名单量词→原字。
- 尝试顺序 g → ml → 量词;首个命中即返回,都不中 → null。

**锚定规则为何能自动排除雷区**(全部落 null,符合「不确定就 null」):
| 名字 | 结果 | 原因 |
|---|---|---|
| `櫻桃/9顆` | (9,顆) | 斜线后 9+顆 ✓ |
| `飯/1碗` / `熟肉/1碗` | (1,碗) | ✓ |
| `牛奶/240ml` | (240,ml) | ml 归一 ✓ |
| `星巴克拿鐵(大杯)/1杯` | (1,杯) | 斜线后 1+杯 ✓(括号在斜线前) |
| `熟麵/1碗(陽春麵…)` / `吐司/1片三角形` | (1,碗)/(1,片) | 数字紧邻单位,单位后缀(括号/文字)忽略 ✓ |
| `花枝/墨魚/3圈` | (3,圈) | 正则要求「斜线+数字」,第一个斜线后是「墨魚」跳过,命中第二个 ✓ |
| `馬鈴薯/3分之2碗` | **null** | 斜线后「3」紧跟「分」非白名单;无其他「/数字」→ 不 match(**不会误抓「2碗」**) |
| `290mL/1瓶` / `中華嫩豆腐/1盒` / `養樂多/1罐` | **null** | 瓶/盒/罐/包 不在白名单(包装词) |
| `熟肉/掌心大` / `地瓜/1個雞蛋大小` | null / (1,個) | 掌心大无前导数字→null;「1個雞蛋大小」1+個命中→(1,個)、后缀忽略 |
| `POP CORNERS…/1份` | **null** | 份不在白名单 |
| `營養標示卡路里/60卡` | **null** | 卡不在白名单 |

> 「份」「瓶/盒/包/罐」「掌心大/指寬/大小」「卡」都因不在白名单而落 null——刻意:base=份无意义;包装词真容量常在别处;模糊比喻量无法结构化。

### D3. API / domain / spec 跟上

- `measureToQuantity(measure, baseAmount) = measure ÷ baseAmount` **不变**;现在家常量有 base 就能算,不再一律 `NullBaseMeasureError`(仅真 null 才抛→400,与 g/ml 同)。
- `food-item.ts` both-or-null 注释、`SeedFoodItem.measureUnit` 类型 `"g"|"ml"|null`→`string|null`。
- openspec `specs/food-dictionary/spec.md`:凡「measure_unit 限 g/ml」措辞改「任意单位字(g/ml/家常量量词)」;`mealItemToJson` / API 回应 `measure_unit` 现可为任意字串(前端会跟)。

### D4. reseed + 计数核对

`scripts/food-seed-source.tsv` 是真相源不改;`npm run seed:gen`→`npm run db:seed`。泛化后计数(proposal-review 用最终白名单+锚定规则对 271 行全量核对):**g 61 / ml 15 / 量词有 base 132 / 仍 null 63 / 共 271**(现状是 g 61 / ml 15 / null 195)。仍 null 的 63 条 = 份/包装词(瓶盒包罐)/模糊量(掌心大·指寬)/分数(分之)/无斜线单位。task 4.2 reseed 时再核对这组数。

## 范围

**含**:schema enum→text + migration(food_item + meal_item);parseBaseMeasure 通用化 + 白名单;domain 类型/注释;spec 更新;reseed + 计数;测试。
**不含**:前端(另开 PR:measureLabelFor 泛化、consumed label、AmountStepper 份数模式统一「份」+ measure 模式显单位字可直接打)。

## 测试(TDD)

- `parseBaseMeasure`:各量词(顆/碗/杯/片/個/條/圈)+ g/克/ml/mL/毫升/cc 归一;edge — `3分之2碗`→null、`290mL/1瓶`→null、`X/1份`→null、`掌心大`→null、`1碗(陽春麵)`→(1,碗)、`墨魚/3圈`→(3,圈)、`60卡`→null。
- `measureToQuantity`:家常量 base(如 9 顆)算 quantity 正常;base=null 仍抛 `NullBaseMeasureError`。
- `seedRowToFoodItem`:家常量行得到 (amount, unit);模糊/包装行 both null(不变量)。
- reseed 计数断言(g/ml/量词有 base/仍 null/共 271)。
- API:家常量食物发 `measure` 能算出 quantity(不再一律 400)。

## 破坏性 & 迁移

measure_unit enum→text 破坏性;单用户、reseed 重建,无需数据搬迁脚本。migration 保留现有 g/ml 值。
