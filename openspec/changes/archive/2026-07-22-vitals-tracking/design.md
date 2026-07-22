# 设计:健康数值后端(vitals-tracking,change 1 / 后端)

## 目标
持久化每人每天的健康数值 —— **体重、体脂**(各一个值)+ 三种「多笔/日」量测:**血压紀录**(收缩/舒张/心跳一组)、**血糖紀录**、**血氧紀录** —— 经 `/api/vitals` 暴露给前端。前端 UI 是另一条 change。比照 bowel 的「每天一笔 + upsert 整笔」,但含三个可变长度的量测清单。

## 心跳的位置
心跳(脉搏)不独立成项,而是**跟着量测走**:家用血压计一起量 sys/dia/脉搏,血氧机也显示脉搏。所以心跳是血压紀录的一个栏位,血氧紀录可选带脉搏。

## 模型(一张表,scalars + 三个 jsonb 数组)
- **`vitals`**:`{ id, user_id, day, weight_kg, body_fat_pct, bp_readings, glucose_readings, spo2_readings }`,unique(user_id, day)。
  - `weight_kg` / `body_fat_pct`:numeric,**可空**(量了才填)。
  - `bp_readings`:jsonb 数组 `[{ systolic: number, diastolic: number, pulse: number|null }]`,默认 `[]`。
  - `glucose_readings`:jsonb 数组 `[{ label: string, value: number }]`(value mg/dL;label 例 "餐前"/"餐后"/自由),默认 `[]`。
  - `spo2_readings`:jsonb 数组 `[{ spo2: number, pulse: number|null }]`(spo2 是 %),默认 `[]`。
  - 无记录的一天 = 两个 scalar null + 三个数组 `[]`。

## Domain(port)
`VitalsRepository`:`get(userId, day): Promise<VitalsRecord | null>`、`set(input): Promise<VitalsRecord>`(upsert,keyed by userId+day)。`SetVitalsInput` 同栏位。
类型:`BpReading { systolic, diastolic, pulse: number|null }`、`GlucoseReading { label, value }`、`Spo2Reading { spo2, pulse: number|null }`。

## Application(use cases)
- `getVitalsDay(repo, userId, day)` → DTO `VitalsDay`(无 userId);无记录回默认空 `{ day, weightKg: null, bodyFatPct: null, bpReadings: [], glucoseReadings: [], spo2Readings: [] }`。
- `setVitalsDay(repo, input)` → upsert 整笔(含三个数组),回记录。

## HTTP(`src/adapters/http/routes/vitals.ts`,authMiddleware,JSON snake_case)
- `GET /api/vitals?day=` → `{ day, weight_kg, body_fat_pct, bp_readings:[{systolic,diastolic,pulse}], glucose_readings:[{label,value}], spo2_readings:[{spo2,pulse}] }`
- `PUT /api/vitals` `{ day, weight_kg, body_fat_pct, bp_readings, glucose_readings, spo2_readings }` → upsert 整笔,回记录
校验:`requireDay`;两个 scalar 用「optional 有限数字或 null」;三个数组各用「optional 数组(默认 [])+ **逐笔先 guard `typeof item === 'object' && item !== null`**,否则 400」,再逐栏:bp `{ systolic, diastolic: requireFiniteNumber; pulse: 有限数字或 null }`,glucose `{ label: string→'', value: requireFiniteNumber }`,spo2 `{ spo2: requireFiniteNumber; pulse: 有限数字或 null }`。非数组或非法笔 → 400(不可 500)。

## Schema / migration
`src/shared/db/schema.ts` 加 `vitals` 表:uuid pk、user_id references users、day date、`weight_kg`/`body_fat_pct` numeric NULL、三个 `jsonb('...').$type<...>().notNull().default([])`、unique(user_id, day)。
**注意**:`jsonb` 目前 schema.ts 没用过 → 要加进 `drizzle-orm/pg-core` import;`$type<...>()` 用**内联型别**(`{ systolic: number; diastolic: number; pulse: number|null }[]` 等)避免从 contexts/ 反向 import 进 shared/db。`npm run db:generate` 产出新 `drizzle/000X_*.sql` 并提交(默认 `'[]'::jsonb`)。
**numeric 转型**:`numeric` 的 Drizzle 写入型是 `string` → 写入时 `x == null ? null : String(x)`,读取时 `x == null ? null : Number(x)`(镜射 `drizzle-water-repository.ts`,**不是** bowel)。

## 测试(vitest)
- application(fake repo):`getVitalsDay`(有记录 / 无记录回默认空含三个空数组)、`setVitalsDay`(upsert scalars + 三数组;含全空、含多笔血压/血糖/血氧、pulse 为 null)。
- http route(比照 `bowel.test.ts`):GET/PUT 正常 + auth + 缺 day / 非数字 scalar / 非法逐笔(null/primitive/缺 value)→ 400 + 三数组多笔 round-trip。
- **createApp/buildApp 呼叫点**:`vitalsRepository` required 会强制更新 app.test.ts、meals.test.ts、water.test.ts、bowel.test.ts 全部补 stub(否则 typecheck/test 挂)。
- `npm test` 绿 + `npm run typecheck` 干净。

## 范围
只加 vitals 相关 domain/application/adapters/route/schema/migration + 测试 + `app.ts`/`index.ts` 接线。不动既有代码。
