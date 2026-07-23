## ADDED Requirements

### Requirement: Import chaodays diet records into meals

An authenticated lifeos user SHALL be able to import their chaodays diet records for
a date range into lifeos meals. Each chaodays record maps to a meal by day and meal
type (breakfast/lunch/dinner/extra → 早餐/午餐/晚餐/點心); its food items are imported
with their staple/meat/fruit/veg portions (oil and sugar are dropped). Import SHALL be
idempotent per (day, meal), judged against the meals that existed **before** this
import: a day+meal that already existed is skipped and left unchanged, while multiple
chaodays records of the same type on the same day (e.g. several 點心) merge into one
meal for that day. Only items with a portion (staple/meat/fruit/veg > 0) become meal
items; oil and sugar are dropped.

#### Scenario: Food items are imported as a meal with portions
- **WHEN** the user imports a range containing a chaodays lunch with food items
- **THEN** a 午餐 meal is created for that day with those items' staple/meat/fruit/veg portions, and oil/sugar are not carried

#### Scenario: Multiple same-type records on a day merge into one meal
- **WHEN** a day has several chaodays extra (點心) records, none pre-existing in lifeos
- **THEN** all their food items are imported into a single 點心 meal for that day (not skipped as duplicates)

#### Scenario: A pre-existing meal is skipped
- **WHEN** a day already had a meal of that meal type in lifeos before the import
- **THEN** that meal type is not imported (counted as skipped once), leaving the existing meal unchanged

#### Scenario: An item with no portion does not become a meal item
- **WHEN** a diet item has no staple/meat/fruit/veg portion (e.g. a glucose-only note or a portionless text)
- **THEN** no meal item is created for it (its glucose, if any, is still extracted)

### Requirement: Extract blood glucose from diet item names into vitals

Blood-glucose values typed into a chaodays diet item's name SHALL be parsed and
appended to that day's vitals glucose readings: `前血糖` as pre-meal, `後血糖` (with an
optional hour marker) as post-meal, `空腹` as fasting, using the record's time. The
food part of the name (with the glucose text removed) is used for the meal item; an
item that is only a glucose note (no food, no portions) does not become a meal item.
Appended readings SHALL be de-duplicated against existing ones so re-import does not
duplicate them, and other vitals fields on the day are preserved.

#### Scenario: Pre/post-meal glucose is extracted
- **WHEN** an item name contains `前血糖：93` and `後血糖(1hr)：70`
- **THEN** that day's vitals gains a pre-meal reading of 93 and a post-meal reading of 70 at the record's time

#### Scenario: A glucose-only note does not create a food item
- **WHEN** an item's name is only glucose text with no food and zero portions
- **THEN** no meal item is created for it, but its glucose is still extracted

#### Scenario: Re-import does not duplicate glucose or erase other vitals
- **WHEN** the same range is imported again
- **THEN** glucose readings already present (same time, value, meal context, and label — so a same-time post-meal 1hr and 2hr are not collapsed) are not appended again, and the day's weight/body-fat/BP/spo2 remain intact

### Requirement: Diet import reuses the connector's auth and error contract

The diet import SHALL use the same chaodays credentials handling and error mapping as
the weight import: credentials/token used transiently and never stored; invalid input
→ 400; wrong chaodays credentials → 400 `chaodays_auth_failed`; upstream failure → 502
`chaodays_unavailable`.

#### Scenario: Wrong credentials and upstream failures map consistently
- **WHEN** chaodays rejects sign-in, or returns a non-auth failure
- **THEN** the diet endpoint returns 400 `chaodays_auth_failed` or 502 `chaodays_unavailable` respectively
