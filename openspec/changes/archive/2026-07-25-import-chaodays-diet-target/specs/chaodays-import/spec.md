## ADDED Requirements

### Requirement: Import chaodays diet targets into daily and water targets

An authenticated lifeos user SHALL be able to import their chaodays daily diet
targets for a date range: each chaodays daily menu's portion targets
(staple/meat/fruit/veg) are written to that day's lifeos daily target, and its water
target is written to that day's lifeos water target. Oil, sugar, notes, and actual
sums are dropped. Import SHALL be idempotent per day per target kind: a day that
already has a lifeos daily target is skipped (its exercise bonus preserved), and a
day that already has a lifeos water target is skipped; a menu with no water target is
not written, and a menu whose portion targets are all zero writes NO daily target (so
it neither clobbers the day's carry-forward standing target nor blocks a later real
import). The import SHALL reuse the chaodays connector's transient-credential and
error contract (invalid input → 400; wrong credentials → 400 `chaodays_auth_failed`;
upstream failure → 502 `chaodays_unavailable`) and SHALL read and write within a
bounded number of DB round-trips regardless of range. The response SHALL summarize
imported and skipped counts for portion targets and water targets.

#### Scenario: Portion and water targets are imported for the range
- **WHEN** the user POSTs valid chaodays credentials and a date range with daily menus
- **THEN** each day's portion targets are written to that day's daily target and each day's water target (when present) to that day's water target, and the response reports the imported and skipped counts

#### Scenario: A day that already has a target is skipped
- **WHEN** a day already has a lifeos daily target or water target
- **THEN** that target is not overwritten (the daily target's exercise bonus is preserved) and the day is counted as skipped for that target kind

#### Scenario: An all-zero-portion menu writes no daily target
- **WHEN** a chaodays daily menu has all portion targets at zero
- **THEN** no daily target is written for that day (it is counted as skipped), leaving any carry-forward standing target intact

#### Scenario: Wrong credentials and upstream failures map consistently
- **WHEN** chaodays rejects sign-in, or returns a non-auth failure
- **THEN** the endpoint returns 400 `chaodays_auth_failed` or 502 `chaodays_unavailable` respectively
