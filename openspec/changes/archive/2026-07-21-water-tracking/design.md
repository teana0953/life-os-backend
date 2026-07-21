# 设计:饮水记录后端(water-tracking,change 1 / 后端)

## 目标
持久化每人每天的**饮水总量** + 一个**每日饮水目标**,经 `/api/water` 暴露给前端。目标的解析逻辑**完全比照 `diet-tracking` 的每日目标**(逐日可设 + carry-forward)。这是「饮水」功能的后端部分;前端 UI 是另一条 change(life-os repo)。

## 模型(两张表,比照 daily_target 的做法)
- **`water_intake`**:`{ id, user_id, day, total_ml }`,unique(user_id, day)。当天的累计饮水量。加水 = upsert `total_ml = max(0, total_ml + add_ml)`。
- **`water_target`**:`{ id, user_id, day, target_ml }`,unique(user_id, day)。**镜射 `daily_target` 的 carry-forward**:查某天目标 → 该天有列用该天;否则结转「最近一次 day ≤ 当天」的 target(`getLatestOnOrBefore`);从没设过 → 0。设定 = upsert。
  - 不做 bonus(饮水没有加码概念,单一 `target_ml`)。base 就是 target 本身。

## Domain(port)
一个 `WaterRepository`(合并 intake + target,水较简单不拆两 port):
- `getIntake(userId, day): Promise<WaterIntake | null>`
- `addIntake(userId, day, addMl): Promise<WaterIntake>`(clamp ≥ 0)
- `getTarget(userId, day): Promise<WaterTarget | null>`
- `getLatestTargetOnOrBefore(userId, day): Promise<WaterTarget | null>`(镜射 daily-target)
- `setTarget(input): Promise<WaterTarget>`(upsert,keyed by userId+day)

## Application(use cases,镜射 diet)
- `getWaterDay(repo, userId, day)` → 解析目标(exact → carry → 0)+ 读总量 → `{ day, totalMl, targetMl, remainingMl }`(remaining = target − total,可为负)。对应 `getDailyTargetWithRemaining` 的缩水版。
- `addWater(repo, userId, day, addMl)` → `total = max(0, total + addMl)`,回新 intake。
- `setWaterTarget(repo, { userId, day, targetMl })` → upsert,回 target。

## HTTP(`src/adapters/http/routes/water.ts`,全部 authMiddleware,JSON 用 snake_case)
- `GET /api/water?day=YYYY-MM-DD` → `getWaterDay` → `{ day, total_ml, target_ml, remaining_ml }`
- `POST /api/water` `{ day, add_ml }` → `addWater` → `{ day, total_ml }`(`add_ml` 可负,服务端 clamp 总量 ≥ 0)
- `PUT /api/water/target` `{ day, target_ml }` → `setWaterTarget` → `{ day, target_ml }`
注册于 `app.ts`;`index.ts` 用 `DrizzleWaterRepository` 接线。沿用 `requireDay`/`requireFiniteNumber` 校验与 `resolveUserId`。

## Schema / migration
在 `src/shared/db/schema.ts` 加 `waterIntake`、`waterTarget` 两表(比照 `dailyTarget`:uuid pk、user_id references users、day date、numeric 量、unique(user_id, day))。`npm run db:generate` 产出新的 `drizzle/000X_*.sql` 并提交。

## 测试(vitest)
- application 单元测试(fake `WaterRepository`):`getWaterDay`(exact 目标 / carry-forward / 从没设过=0 / 总量读取 / remaining 可负)、`addWater`(clamp ≥ 0、累加)、`setWaterTarget`(upsert)。
- http route 测试(比照 `daily-target.test.ts`/`meals.test.ts`):三个 endpoint 的正常路径 + 需要 auth + 缺 `day`/非数字的校验错误。
- `npm test` 绿 + `npm run typecheck` 干净。

## 范围
只加 water 相关的 domain/application/adapters/route/schema/migration + 测试 + `app.ts`/`index.ts` 接线。不动既有 diet 代码。
