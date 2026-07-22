# 设计:vitals range 趋势查询(add-vitals-range,功能 C2 / 後端)

## 目标
把既有 vitals(逐日:体重/体脂 scalar + 血压/血糖/血氧 readings 阵列)在一个日期区间内**攤成每指标每日时间序列**,给前端趋势图(dashboard 第二张卡)。纯後端、additive。

## 范围决策
- **additive 扩既有 vitals repo**:加 `listRange`,不建新表、不新增 CreateAppOptions 栏位。
- **每日聚合成一点**:readings 阵列(一天多笔)取**当日平均**(v1 简单)。不做 min/max band、不做 per-reading 时间解析度(延後)。
- **每指标独立序列**:某天该指标无值就不产生点(前端画折线自然断点/略过)。

## 模型 / repo
`VitalsRepository` 加(additive):
- `listRange(userId, from, to): Promise<VitalsRecord[]>` —— day 落在 `[from, to]`(闭区间)的记录,依 day 升冪。Drizzle:`where(userId 且 day >= from 且 day <= to) orderBy(day asc)`。

**纯函式 helper**(`src/contexts/health/domain/vitals-series.ts`,domain 零外层 import,便于单元测试):
- `Point { day: string; value: number }`;`VitalsSeries { weight, bodyFat, systolic, diastolic, pulse, glucose, spo2: Point[] }`。
- `buildVitalsSeries(records: VitalsRecord[]): VitalsSeries`:records 已按 day 升冪。逐 record 逐指标:
  - weight/bodyFat:scalar 非 null → push `{day, round1(value)}`。
  - systolic/diastolic:`bpReadings` 非空 → 当日各栏平均 → `round0` → push。
  - pulse:蒐集当日所有非 null pulse(`bpReadings[].pulse` + `spo2Readings[].pulse`);非空 → 平均 round0 → push。
  - glucose:`glucoseReadings` 非空 → value 平均 round0 → push。
  - spo2:`spo2Readings` 非空 → spo2 平均 round0 → push。
  - `round1` = 四舍五入 1 位小数;`round0` = Math.round。空阵列/全 null → 该指标该天无点。

## Application(use case)
- `getVitalsRange(vitalsRepo, userId, from, to)` → DTO `VitalsRangeOverview { from, to, series: VitalsSeries }`:`listRange` 取记录 → `buildVitalsSeries`。

## HTTP(`src/adapters/http/routes/vitals.ts` 内新增 handler 或新档,全 authMiddleware,snake_case)
- `GET /api/vitals/range?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ from, to, series: { weight:[{day,value}], body_fat:[...], systolic:[...], diastolic:[...], pulse:[...], glucose:[...], spo2:[...] } }`。
- 校验:`from`/`to` 用 `requireDay`(缺/非法→400);`from > to` → `BadRequestError`→400(避免 onError→500)。
- 注册于 `app.ts`(复用既有 `vitalsRepository`,**无新 CreateAppOptions 栏位**);handler 可加进既有 vitals route factory 或新 `createGetVitalsRangeHandler`。

## 测试(vitest)
- domain helper 单元(`vitals-series.test.ts`):
  - scalar → 每记录一点、跳过 null 日(spec:07-01 weight52 / 07-03 weight51.7,07-02 无 → weight 序列两点)。
  - bp 平均(118/76 + 122/80 → systolic 120 / diastolic 78);pulse 合并 bp+spo2(70,74→72);glucose/spo2 平均;空阵列→该指标无点;round1/round0。
- application 单元(fake repo):`getVitalsRange` 委派 listRange + helper,回 {from,to,series}。
- http route 测试(比照 vitals app 测试):`GET /api/vitals/range?from=&to=` 正常回 series;需 auth;缺/非法 from/to→400;from>to→400。
- **补 `listRange` 到所有 vitals fake**:grep `implements VitalsRepository` 与 `VitalsRepository = {` 的每处(约 10 处 createApp 呼叫点 + application 层 fake)加 `listRange`,否则 typecheck 红。
- `npm test` 绿 + `npm run typecheck` 干净。

## 明确延後
- min/max band、per-reading(带 time)解析度、平滑/移动平均。
- 与生理期叠图(前端 C2 选配)、份量/达标聚合(C3)。

## 范围
只加 vitals `listRange`(additive)+ vitals-series helper + getVitalsRange use case + /api/vitals/range route + 测试(含补齐 fake)。不动既有 vitals 行为、无 schema 变更、无 migration。
