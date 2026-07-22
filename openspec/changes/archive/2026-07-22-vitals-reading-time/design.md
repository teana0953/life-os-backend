# 设计:每笔量测加时间(vitals-reading-time,change 1 / 后端)

## 目标
让 vitals 的三种「多笔/日」量测(血压/血糖/血氧)**每一笔都带一个时间**(当天内的 `HH:mm`,必填)。这样一天多次量测能分辨先后。前端 UI 另一条 change。

## 变动(小,无 migration)
`glucose_readings`/`bp_readings`/`spo2_readings` 是 jsonb 数组(schemaless),加一个 `time` 栏位**不需要 migration**,只动型别 + 校验。

- **Domain**(`src/contexts/health/domain/vitals.ts`):三个 reading 型别各加 `time: string`(HH:mm)。
- **HTTP PUT 校验**(`src/adapters/http/routes/vitals.ts`):每一笔 reading 现在**必填 `time`**——非空字串(400 if 缺/空)。沿用现有逐笔 object guard;在每笔的栏位校验里加 `time: requireString(item.time, '...time')`(requireString 已会 reject 空字串,正好当必填)。
- **HTTP GET / adapter 容错**:既有资料的 reading 可能没有 `time`(此功能之前存的)。读取时 coerce `time: typeof r.time === 'string' ? r.time : ''`,让旧资料不炸(回空字串);新写入才强制必填。DrizzleVitalsRepository 读 jsonb 时对每笔套这个 coerce。
- **格式**:先只要求非空字串(前端时间选择器保证 HH:mm);不在后端做严格 HH:mm regex(避免过度、且前端已保证)。

## 测试(vitest)
- application/route:PUT 带 time 的三种 reading round-trip(回传含 time);PUT 某笔缺 time / 空 time → 400;GET 一笔没有 time 的既有资料 → time 读为 ''(容错)。
- 既有 vitals 测试要更新:之前建 reading 的地方补上 `time`(否则 required 校验或型别会挂)——app/route/application 测试里的 reading fixture 都加 time。
- `npm test` 绿 + `npm run typecheck` 干净。

## 范围
只动 vitals 的 domain 型别 + route 校验 + adapter 读取 coerce + 相关测试。无 schema/migration,无新 endpoint。不动其他。
