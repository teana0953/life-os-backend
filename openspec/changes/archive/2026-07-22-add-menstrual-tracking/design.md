# 设计:月经週期記錄後端(menstrual-tracking,功能 B / 後端)

## 目标
持久化每人的**月经週期**列表(每笔一个週期 = 起始日 + 可空结束日),读取时算简单统计(平均週期长度、平均经期天数、预测下次起日),经 `/api/menstrual` 暴露给前端。前端 UI 是另一条 change。纯後端、统计读时算;不做週期重叠验证、不做排卵/受孕期预测(延后)。

## 范围决策(为什么这样切)
- **命名用 menstrual**,避免 `period` 与「时间区间」语意重叠。context 放 `health`(与 water/bowel/vitals/exercise 一致)。
- **非 day-keyed**:与其他 tracker 不同,一笔是**日期区间**(start→optional end),一个 user 多笔;支援 add / **update(PATCH)** / delete。update 存在的理由:经期结束时补上 endDate,或修正日期。
- **统计不落库、读时算**:避免与来源资料不同步;计算便宜。

## 模型
**`menstrual_period` 表**:`{ id uuid pk, user_id fk→users, start_date date, end_date date(nullable), created_at timestamp default now }`,index `(user_id, start_date)`(无 unique;允许多笔)。

**domain**
- `MenstrualPeriod { id, userId, startDate, endDate: string | null }`(`src/contexts/health/domain/menstrual-period.ts`)。`startDate`/`endDate` 为 ISO 日字串 `YYYY-MM-DD`。
- `MenstrualRepository` port(`menstrual-repository.ts`):
  - `add(input: AddPeriodInput): Promise<MenstrualPeriod>`(`{userId, startDate, endDate}`)
  - `listByUser(userId): Promise<MenstrualPeriod[]>`(按 startDate 升冪)
  - `update(userId, id, patch: UpdatePeriodPatch): Promise<MenstrualPeriod | null>`(owned-only;非 owned/不存在回 null。**partial update**:只更新 patch 里**有给**的欄位)
  - `delete(userId, id): Promise<boolean>`(owned-only)

  `UpdatePeriodPatch { startDate?: string; endDate?: string | null }` —— **partial-update 三态语意**:`startDate`/`endDate` **缺席(undefined)= 保留现值不动**;`endDate: null` = **清除结束日**(把已完成週期改回进行中);`endDate: '<day>'` = 设为该日。绝不能把「缺席」当成 null 洗掉现值。

## Application(use cases)
- `addPeriod(repo, input)`:校验 `endDate == null || endDate >= startDate`(否则抛领域错误);add 回传。
- `updatePeriod(repo, userId, id, patch)`:先经 `listByUser` 找到该 owned 笔(找不到→回 null),把 patch 里**有给**的欄位合并到现值(缺席欄位保留;`endDate: null` 清除),校验合并後 `endDate == null || endDate >= startDate`(违反抛领域错误),再 `repo.update`。非 owned/不存在回 null。**关键**:合并只看「patch 有没有该 key」,缺席 = 不动现值(不可当 null 洗掉 endDate)。
- `deletePeriod(repo, userId, id)`:回 boolean。
- `getMenstrualOverview(repo, userId)`:`listByUser` 後算统计,回 DTO：
  ```
  MenstrualOverview {
    periods: MenstrualPeriod[],                // 按 startDate 升冪
    stats: { averageCycleDays: number|null,
             averagePeriodDays: number|null,
             predictedNextStart: string|null },
    lastPeriod: MenstrualPeriod | null          // startDate 最大者
  }
  ```
  统计算法(纯函式,便于单元测试;放 domain 或 application 的 helper):
  - `averageCycleDays`：相邻 startDate 的天数差,取**最近 N 段**(N=6，即最多近 6 个间隔)的平均,四舍五入为整数;**需 ≥2 笔**,否则 null。
  - `averagePeriodDays`：仅**已完成**(endDate 非 null)週期的 `end - start + 1` 平均(四舍五入整数);**需 ≥1 完成**,否则 null。
  - `predictedNextStart`：`lastStart + averageCycleDays` 天(ISO 日);`averageCycleDays` 为 null 时 null。
  - 日期天数差用 UTC 纯日期计算,避免时区/DST 漂移(参考 vitals/diet 既有日期处理)。

## HTTP(`src/adapters/http/routes/menstrual.ts`,全 authMiddleware,JSON snake_case)
- `GET /api/menstrual` → `{ periods:[{id,start_date,end_date}], stats:{average_cycle_days,average_period_days,predicted_next_start}, last_period }`
- `POST /api/menstrual` `{start_date, end_date?}` → 建立的週期(单笔形状 `{id,start_date,end_date}`)
- `PATCH /api/menstrual/:id` `{start_date?, end_date?}` → 更新的週期,或 not-found（回 404 或 `null`，见下）
- `DELETE /api/menstrual/:id` → `{deleted: true|false}`

注册于 `app.ts`;`index.ts` 用 `DrizzleMenstrualRepository` 接线。
- **POST**:`start_date` 必填 `requireDay`;`end_date` 可空 `typeof body.end_date === 'string' ? requireDay(body.end_date,'end_date') : null`。
- **PATCH**:**依 body 是否含该 key 建 patch**（比照 `meals.ts:createUpdateMealItemHandler`,别套 POST 模式)：
  - `'start_date' in body` → `patch.startDate = requireDay(body.start_date,'start_date')`;缺席则不放(保留现值)。
  - `'end_date' in body` → `patch.endDate = typeof body.end_date === 'string' ? requireDay(body.end_date,'end_date') : null`(显式 null 清除);缺席则不放(保留现值)——**绝不因缺席而洗成 null**。
- **end<start 抛 `BadRequestError`→400**(在 use case 合并後校验；避免 onError→500 的 meals.ts 坑)。
- PATCH/DELETE 非 owned/不存在:PATCH 回 **404** `c.json({error:'not_found'},404)`(比照 meals，不会误 500);DELETE 回 200 `{deleted:false}`（与 exercise 一致）。
- `:id` 取 `c.req.param('id')`。

## Schema / migration
在 `src/shared/db/schema.ts` 加 `menstrualPeriod` 表（uuid pk、user_id references users、start_date date、end_date date nullable、created_at timestamp default now、index on (user_id, start_date)）。`npm run db:generate` 产新 `drizzle/000X_*.sql` 并提交。

## 测试(vitest)
- domain/helper 单元:统计纯函式——averageCycleDays（0/1 笔→null；等间隔；近 N 截断）、averagePeriodDays（无完成→null；含 open 週期只算完成的）、predictedNextStart（有/无 cycle）。用 spec 的 worked example（05-01/05-29/06-26 → 28 天、预测 07-24）当测试。
- application 单元(fake `MenstrualRepository`):addPeriod（正常/ end<start 抛错）、updatePeriod（补 endDate；非 owned→null；合并後 end<start 抛错）、deletePeriod（owned→true/非 owned→false）、getMenstrualOverview（空→空+null 统计；多笔→periods 排序+stats+lastPeriod）。
- http route 测试(比照 exercise/water app 测试):四 endpoint 正常路径 + 需 auth + 校验错误（缺 start_date、end<start→400）+ PATCH/DELETE 他人 id 不动（PATCH 404 / DELETE {deleted:false}）。
- `npm test` 绿 + `npm run typecheck` 干净。

## 明确延後(不在本 change)
- 週期重叠验证、排卵/受孕期/生理期阶段预测。
- 与体重趋势叠图解读（属功能 C dashboard）。
- 症状/流量/备注等额外栏位。

## 范围
只加 menstrual 相关 domain/application/adapters/route/schema/migration + 测试 + `app.ts`/`index.ts` 接线。不动既有代码。
