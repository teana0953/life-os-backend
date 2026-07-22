# 设计:身体资料 + 体重目标总览(add-body-profile,功能 C1 / 後端)

## 目标
持久化每 user 的身体资料(身高 height_cm、目标体重 target_weight_kg),并读时算「体重目标总览」(今日体重/剩余/达成率/BMI),经 `/api/body-profile` + `/api/weight-goal` 暴露给前端 dashboard 目标卡。纯後端。

## 范围决策
- **身体资料非 day-keyed**:每 user 一笔、相对静态(对齐 chaodays 会员资料)。context 放 health。
- **今日体重来自既有 vitals**:不重复存体重;vitals repo 加两个 additive read(最近/最早非空体重)。
- **统计读时算**:remaining/bmi/achievement 都不落库。
- **延後**:份量目标自动计算(需生理性别)、达标率成就环(C3)。

## 模型
**`body_profile` 表**:`{ user_id uuid pk(唯一,references users)、height_cm numeric(nullable)、target_weight_kg numeric(nullable)、updated_at timestamp default now }`。**每 user 一笔,upsert by user_id**。

**domain**
- `BodyProfile { userId, heightCm: number | null, targetWeightKg: number | null }`(`src/contexts/health/domain/body-profile.ts`)。
- `BodyProfileRepository` port(`body-profile-repository.ts`):
  - `get(userId): Promise<BodyProfile | null>`
  - `upsert(userId, patch: UpdateBodyProfilePatch): Promise<BodyProfile>` —— `UpdateBodyProfilePatch { heightCm?: number; targetWeightKg?: number }`,**partial**:只更新 patch 里**有给**的栏位(缺席保留现值)。实作以 key-presence 建 update set(比照 menstrual/meals 的 partial update;空 patch → no-op 回现值,避免 Drizzle `.set({})`)。
- **BMI/达成率纯函式 helper**(`weight-goal-stats.ts`,domain 零外层 import,便于单元测试):
  - `computeBmi(weightKg, heightCm): number | null` —— 任一 null/≤0 回 null;`weight / (height/100)^2` 四舍五入 1 位小数。
  - `computeAchievementRate(baseline, current, target): number | null` —— `(baseline − current)/(baseline − target)` × 100,clamp 0–100 取整;当 baseline/current/target 任一 null 或 baseline===target 回 null。

**vitals repo 扩充(additive)** —— `VitalsRepository` 加:
- `getLatestWeight(userId): Promise<number | null>` —— vitals 表 `weight_kg` 非 null 中 day 最大者的 weight。
- `getEarliestWeight(userId): Promise<number | null>` —— day 最小者的 weight。
(Drizzle:`where(userId 且 weight_kg is not null) orderBy(day desc/asc) limit 1`。)

## Application(use cases)
- `getBodyProfile(repo, userId)` → `BodyProfile`;无记录回默认 `{ heightCm: null, targetWeightKg: null }`(镜射既有「无则回默认」)。
- `setBodyProfile(repo, userId, patch)` → 校验 patch 里有给的 heightCm/targetWeightKg 为正数(否则抛领域错误);upsert 回 profile。
- `getWeightGoal(bodyProfileRepo, vitalsRepo, userId)` → DTO `WeightGoalOverview { heightCm, targetWeightKg, currentWeightKg, remainingKg, achievementRate, bmi }`:
  - profile 取 heightCm/targetWeightKg;`currentWeightKg = vitalsRepo.getLatestWeight`;baseline = `vitalsRepo.getEarliestWeight`。
  - `remainingKg = (current!=null && target!=null) ? current − target : null`。
  - `bmi = computeBmi(current, height)`;`achievementRate = computeAchievementRate(baseline, current, target)`。

## HTTP(`src/adapters/http/routes/body-profile.ts`,全 authMiddleware,JSON snake_case)
- `GET /api/body-profile` → `{ height_cm, target_weight_kg }`(未设回 null)
- `PUT /api/body-profile` `{ height_cm?, target_weight_kg? }` → partial upsert 回 `{ height_cm, target_weight_kg }`
- `GET /api/weight-goal` → `{ height_cm, target_weight_kg, current_weight_kg, remaining_kg, achievement_rate, bmi }`

注册于 `app.ts`;`index.ts` 用 `DrizzleBodyProfileRepository` + 既有 `vitalsRepository` 接线。
- **PUT 依 body key presence 建 patch**(比照 menstrual):`if ('height_cm' in body)` 才放、`if ('target_weight_kg' in body)` 才放;值须为**正数**,否则 `BadRequestError`→400。**非数/非正的怪值(0/负/字串/物件)一律 400**,别静默吞(menstrual end_date 教训)。用一个小 `parsePositiveNumber(value, field)` helper:number 且 >0 → 用;否则抛 BadRequestError。
- 数值用 `requireFiniteNumber` 后断言 >0,或直接 parsePositiveNumber。

## Schema / migration
`src/shared/db/schema.ts` 加 `bodyProfile` 表(user_id uuid references users 且 **unique/pk**、height_cm numeric nullable、target_weight_kg numeric nullable、updated_at timestamp default now)。`npm run db:generate` 产新 `drizzle/000X_*.sql` 并提交。

## 测试(vitest)
- domain helper 单元:`computeBmi`(正常 1 位小数/任一 null 或 ≤0→null)、`computeAchievementRate`(worked example 55/52/51→75;clamp;baseline==target→null;任一 null→null)。
- application 单元(fake repos):`getBodyProfile`(有/无记录默认)、`setBodyProfile`(partial:只改 target 保留 height;非正数抛错)、`getWeightGoal`(full overview:height165/target51/earliest55/latest52 → current52/remaining1/bmi19.1/achievement75;无 target→remaining/achievement null;单笔体重→achievement null)。
- http route 测试(比照 vitals/menstrual app 测试):三 endpoint 正常 + 需 auth + PUT 校验(负/0/非数→400,且 profile 不变)+ partial(只 PUT target 不动 height)。
- `npm test` 绿 + `npm run typecheck` 干净。

## 明确延後
- 份量目标依身高体重自动计算(需生理性别)。
- 达标率成就环聚合(C3)。
- 生理性别、初始体重(若日後 achievement 想用「使用者自订初始体重」而非最早记录)。

## 范围
只加 body-profile 相关 domain/application/adapters/route/schema/migration + vitals repo 两个 additive read + 测试 + `app.ts`/`index.ts` 接线。不动既有行为。
