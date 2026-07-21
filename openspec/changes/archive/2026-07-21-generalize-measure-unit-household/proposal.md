## Why

The measure basis (`base_amount` + `measure_unit`) lets `diet-tracking` convert
an entered amount to a portion quantity (`quantity = measure ÷ base_amount`) and
label the amount in the food's own unit — but only for gram/millilitre foods.
Of the 271 seeded foods, **195 are household-unit foods** (顆/碗/杯/片/個…) whose
`base_amount` and `measure_unit` are both null, because `parseBaseMeasure` only
recognizes g/克/ml/毫升/cc. So `櫻桃/9顆` stores only `{ fruit: 1 }` (1 fruit
portion) — the "1 portion = 9 cherries" ratio (the `9`) is never captured
structurally; it lives only in the name string and is discarded at parse time.

As a result the client cannot treat 顆/碗/杯 like g/ml: it shows a misleading
consumed amount ("1 顆" when 1 portion is really 9), sending a `measure` for a
household food is rejected with `NullBaseMeasureError` → 400, and the
portion-mode unit word is scraped from the name. The user asked for 顆 (and the
other household units) to be handled **the same as g and ml**.

## What Changes

- **Generalize `measure_unit` from an enum to open text.** `food_measure_unit`
  pgEnum('g','ml') → a `text` column on both `food_item` and `meal_item`,
  storing `'g'`/`'ml'` or any quantifier word (`'顆'`/`'碗'`/`'杯'`…). Drizzle
  migration preserves existing g/ml values. The both-or-null invariant is kept.
- **Generalize seed `parseBaseMeasure`** to also parse a whitelist of countable
  quantifiers (個/顆/碗/片/杯/條/隻/根/湯匙/球/圈/截/塊/串/尾/瓣/粒), anchored to
  `/ + number + unit` so ambiguous tokens (fractions like `3分之2碗`, packaging
  words 瓶/盒/包/罐, vague sizes 掌心大/指寬, `份`, `卡`) safely stay null.
- **API/domain/spec follow the type change**: `measureToQuantity` is unchanged
  but now succeeds for household foods that have a base; `measure_unit` in
  responses may be any string.
- **Reseed** and record the new base-measure coverage counts.

Breaking (enum→text + reseed); single user, dev DB rebuilt, no data migration
script needed. **Backend only** — the frontend follows in a separate PR
(generalize the unit label, fix the consumed-amount display, show 份 in
portion mode and the unit word in measure mode).

## Capabilities

### Modified Capabilities

- `food-dictionary`: the measure basis is no longer limited to g/ml — any
  countable household quantifier may be a `measure_unit`, and the seed backfills
  it for whitelisted quantifier units.
