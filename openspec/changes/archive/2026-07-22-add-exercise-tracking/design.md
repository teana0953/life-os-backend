# 设计:运动记录后端(exercise-tracking,change 1 / 后端)

## 目标
持久化每人每天的**运动记录**,经 `/api/exercise` 暴露给前端。与 bowel/vitals 的「单笔 upsert」不同,运动是**累计型**:一天一个 *列表*,每笔独立新增/删除(镜射 meals 的「一天多笔 item」)。初版**纯记录**:不做「运动→加当日饮食份量目标」联动、不做趋势图、不做使用者自订运动库。前端 UI 是另一条 change。

## 范围决策(为什么这样切)
- **运动库用静态常数,不建资料表**:初版运动库小、不可自订、无 favorites/搜寻需求,不需要 food_dictionary 那套(表+seed pipeline+custom+favorite)。用一个 in-code 常数 + 唯读 API 就够(YAGNI)。日后要自订库再升级成表。
- **entry 只存 `activity_id`,读时 enrich**:库是静态且永不删除的共享资料,读时用 id 查库补上 name/category,不在 entry 里快照(与 meal_item 快照 name 的取舍不同 —— meal 的食物可被删/改,运动库不会)。查无对应时 name 回 null(防御)。
- **支援 新增 + 删除,不支援 update**:编辑 = 删除再新增。最小面。

## 模型
**静态运动库**(`src/contexts/health/domain/exercise-activity.ts` 的常数 `EXERCISE_ACTIVITIES`):
每笔 `ExerciseActivity { id: string, name: string, category: 'aerobic' | 'anaerobic', intensity: string }`。`intensity` 是描述性标签(如 `8km/hr`)。附一个 `findActivity(id)` 查找函式。初版放少量代表性项目(慢跑、快走、骑车、游泳、重训…),来源见 chaodays 研究。

**`exercise_log` 表**(一天多笔):`{ id, user_id, day, activity_id, duration_minutes, note, created_at }`。
- `activity_id`:text,写入时校验存在于静态库。
- `duration_minutes`:integer,> 0。
- `note`:text,可空 / 默认空字串。
- 无 unique 约束(同一天同一活动可多笔);index 于 `(user_id, day)`。

## Domain(port)
`ExerciseRepository`(`src/contexts/health/domain/exercise-repository.ts`):
- `addEntry(input: AddExerciseEntryInput): Promise<ExerciseEntry>`
- `listByDay(userId, day): Promise<ExerciseEntry[]>`(按 created_at 升冪)
- `deleteEntry(userId, entryId): Promise<boolean>`(owned 才删,回是否删除)

`ExerciseEntry { id, userId, day, activityId, durationMinutes, note, createdAt }`(`src/contexts/health/domain/exercise-entry.ts`)。
`AddExerciseEntryInput { userId, day, activityId, durationMinutes, note }`。

## Application(use cases)
- `listExerciseActivities()` → 回静态库(纯回常数,给 route 用;放 use case 层以维持 HTTP 不直接依赖 domain 常数的一致性)。
- `logExercise(repo, input)` → 校验 `activityId` 在库内(不在 → 抛领域错误),`durationMinutes > 0`,append 一笔并回传。
- `getExerciseDay(repo, userId, day)` → 回 DTO `ExerciseDay { day, entries: ExerciseDayEntry[], totalMinutes }`;每笔 enrich `activityName`/`category`(查静态库,查无回 null);`totalMinutes` = 各笔 duration 加总;无记录回 `{ day, entries: [], totalMinutes: 0 }`(镜射 bowel/water「无则回默认」)。
- `deleteExerciseEntry(repo, userId, entryId)` → 回是否删除。

## HTTP(`src/adapters/http/routes/exercise.ts`,全部 authMiddleware,JSON snake_case)
- `GET /api/exercise/activities` → `[{ id, name, category, intensity }]`
- `GET /api/exercise?day=YYYY-MM-DD` → `{ day, entries: [{ id, activity_id, activity_name, category, duration_minutes, note, created_at }], total_minutes }`
- `POST /api/exercise` `{ day, activity_id, duration_minutes, note }` → 回建立的 entry(同上单笔形状)
- `DELETE /api/exercise/:id` → `{ deleted: true|false }`
注册于 `app.ts`;`index.ts` 用 `DrizzleExerciseRepository` 接线。沿用 `resolveUserId`、`requireDay`;`duration_minutes` 用 `requireFiniteNumber` 后再校验 > 0(非正数抛 400);`activity_id` 非法(不在库)抛 400;`note` 比照 bowel 的 note 处理(`typeof === 'string' ? ... : ''`,**不可**用 `requireString`,它拒空字串)。

## Schema / migration
在 `src/shared/db/schema.ts` 加 `exerciseLog` 表(uuid pk、`user_id` references users、`day` date、`activity_id` text、`duration_minutes` integer、`note` text 可空/默认 ''、`created_at` timestamp 默认 now、index on `(user_id, day)`)。`npm run db:generate` 产出新的 `drizzle/000X_*.sql` 并提交。

## 测试(vitest)
- domain 单元:静态库 `findActivity` 命中/未命中。
- application 单元(fake `ExerciseRepository`):
  - `logExercise` — 正常 append;`activityId` 不在库 → 抛错;`durationMinutes <= 0` → 抛错。
  - `getExerciseDay` — 有多笔(enrich name/category + totalMinutes 加总)/ 无记录回空默认 / entry 参照库外 id 时 name 回 null。
  - `deleteExerciseEntry` — owned 删除回 true;非 owned 回 false。
- http route 测试(比照 `water.test.ts`/`bowel` app 测试):四个 endpoint 正常路径 + 需要 auth + 校验错误(缺 `day`、未知 `activity_id`、非正 `duration`)+ 删除他人 entry 不动。
- `npm test` 绿 + `npm run typecheck` 干净。

## 明确延后(不在本 change)
- 运动 → 增加当日饮食目标份量(联动)—— 留给 goals/dashboard change。
- 90 天趋势图。
- 使用者自订运动库 / favorites / 最爱。
- 消耗热量计算(需强度公式 + 体重,属联动/dashboard 范畴)。
- entry 的 update(初版用删+增替代)。

## 范围
只加 exercise 相关 domain/application/adapters/route/schema/migration + 测试 + `app.ts`/`index.ts` 接线。不动既有代码。
