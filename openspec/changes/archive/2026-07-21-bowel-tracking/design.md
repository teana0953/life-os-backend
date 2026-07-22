# 设计:排便记录后端(bowel-tracking,change 1 / 后端)

## 目标
持久化每人每天的排便记录 —— **次数、是否正常、free-text 备注**,经 `/api/bowel` 暴露给前端。比 water 更简单:没有 target、没有累加,单纯 upsert 当天整笔。前端 UI 是另一条 change。

## 模型(一张表)
- **`bowel_log`**:`{ id, user_id, day, count, is_normal, note }`,unique(user_id, day)。
  - `count`:整数(当天排便次数,≥ 0)。
  - `is_normal`:boolean,**可空**(null = 未记录是否正常,避免空日被误标正常)。
  - `note`:text,可空 / 默认空字串(free-text 备注)。

## Domain(port)
`BowelRepository`:
- `get(userId, day): Promise<BowelLog | null>`
- `set(input): Promise<BowelLog>`(upsert,keyed by userId+day)。`SetBowelLogInput { userId, day, count, isNormal, note }`。

## Application(use cases)
- `getBowelDay(repo, userId, day)` → 该天记录;无记录时回默认空 `{ day, count: 0, isNormal: null, note: '' }`(镜射 diet/water「无则回默认」的做法)。
- `setBowelDay(repo, input)` → upsert,回记录。

## HTTP(`src/adapters/http/routes/bowel.ts`,全部 authMiddleware,JSON snake_case)
- `GET /api/bowel?day=YYYY-MM-DD` → `{ day, count, is_normal, note }`
- `PUT /api/bowel` `{ day, count, is_normal, note }` → upsert 整笔,回 `{ day, count, is_normal, note }`
注册于 `app.ts`;`index.ts` 用 `DrizzleBowelRepository` 接线。沿用 `requireDay`/`requireFiniteNumber` 与 `resolveUserId`;`is_normal` 用可选 boolean 校验(缺省 null),`note` 可选字串。

## Schema / migration
在 `src/shared/db/schema.ts` 加 `bowelLog` 表(uuid pk、user_id references users、day date、count numeric/integer、is_normal boolean(可空)、note text(可空)、unique(user_id, day))。`npm run db:generate` 产出新的 `drizzle/000X_*.sql` 并提交。

## 测试(vitest)
- application 单元(fake `BowelRepository`):`getBowelDay`(有记录 / 无记录回默认空 count0/isNormal null/note '')、`setBowelDay`(upsert count/is_normal/note,含 is_normal=null 与 note 空)。
- http route 测试(比照 `water.test.ts`/`app.test.ts`):GET/PUT 正常路径 + 需要 auth + 缺 `day`/非数字 count 的校验错误 + is_normal 可空/note 可选。
- `npm test` 绿 + `npm run typecheck` 干净。

## 范围
只加 bowel 相关 domain/application/adapters/route/schema/migration + 测试 + `app.ts`/`index.ts` 接线。不动既有代码。
