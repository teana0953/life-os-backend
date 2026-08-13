import { describeErrorChain } from "../../../adapters/http/error-logging";
import type { UserRepository } from "../../user/domain/user-repository";
import type { CareDayInstanceManager, CareDayInstancePointerStore } from "../domain/care-day-instance";

/** Payload a `CareReminderWorkflow` instance is created with. */
export interface CareReminderWorkflowParams {
  userId: string;
  localDate: string;
  timezone: string;
}

/**
 * Deterministic instance id: one instance per (user, local day) — W1 in
 * design.md. Cloudflare Workflows instance ids must match
 * `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$` (max 100 chars) — `:` is NOT allowed, so
 * `_` separates the fields (both `userId` and `localDate` already contain
 * `-`, so `_` keeps the field boundaries readable).
 */
export function careDayInstanceId(userId: string, localDate: string): string {
  return `care-day_${userId}_${localDate}`;
}

/**
 * Driven adapter: implements `CareDayInstanceManager` via the
 * `CARE_REMINDER_WORKFLOW` Workflows binding. `Workflow<PARAMS>` is the
 * ambient global type `@cloudflare/workers-types` declares for a Workflows
 * binding — this is the one file allowed to import/reference it
 * (`domain`/`application` never see it, per this repo's dependency rule).
 *
 * Looks the user's timezone up fresh on every call (never cached) — a
 * `restartToday` triggered BY a timezone change must see the new value, not
 * a stale one captured before the change that triggered it.
 */
export class WorkflowsCareDayInstanceManager implements CareDayInstanceManager {
  constructor(
    private readonly workflow: Workflow<CareReminderWorkflowParams>,
    private readonly userRepository: Pick<UserRepository, "getById">,
    private readonly pointerStore: CareDayInstancePointerStore,
  ) {}

  private async resolveTimezone(userId: string): Promise<string> {
    return (await this.userRepository.getById(userId))?.timezone ?? "Asia/Taipei";
  }

  async ensureFor(userId: string, localDate: string): Promise<void> {
    try {
      const timezone = await this.resolveTimezone(userId);
      await this.workflow.create({
        id: careDayInstanceId(userId, localDate),
        params: { userId, localDate, timezone },
      });
    } catch (err) {
      // Expected outcome includes a deterministic id collision (an instance
      // already exists for today), but also any real Workflows API failure —
      // there's no documented way to tell them apart from the error shape,
      // so log everything rather than risk staying silent on a real failure.
      console.error("ensureFor: workflow.create failed", describeErrorChain(err));
    }
  }

  /**
   * fix/restart-instance-tracking: terminate-then-create always uses a fresh
   * suffixed id (`${deterministicId}_r${uuid}`), NOT the deterministic one —
   * Cloudflare rejects `create()` for any id used before, even a
   * just-terminated one, within its retention window, so re-creating with
   * `deterministicId` would deterministically fail every time (goal.md Bug
   * B). But that means the id a later `restartToday` needs to terminate is
   * NOT derivable from `(userId, localDate)` alone — it has to be looked up.
   * `pointerStore` is that lookup: the one durable record of which id the
   * previous `restartToday` created, so THIS call can find and terminate it
   * (design.md W1 — "one (user, local day) instance" is restored by this
   * table, not by id determinism, on this path).
   *
   * fix/restart-instance-tracking follow-up (2nd round): the FIRST version of
   * this method wrote the pointer BEFORE calling `create()`, then re-read the
   * pointer after `create()` resolved as a "reconciliation" check to catch a
   * later call that had superseded it in between. That order was proven
   * unsound (a probe test forcing a second interleaving — B slow between its
   * own terminate and its own CAS — still landed two live instances): winning
   * a CAS only proves `newId` WAS current at the instant the CAS committed,
   * so a call can legitimately read `newId` as `recorded` and terminate it
   * — a no-op, since `newId` does not exist yet — before the original call's
   * `create()` has even run. No amount of re-checking AFTER the fact closes a
   * window that lets a terminate land on an id that isn't created yet; the
   * ordering itself has to change.
   *
   * **This version creates first, THEN compare-and-swaps the pointer to the
   * id it just created.** That establishes an invariant by construction:
   * *the pointer never names an id that hasn't been created yet* — every
   * value `getCurrent` can ever return was written by a CAS that only ran
   * after its own `create()` had already resolved. Inductively, that means
   * `recorded` (whatever a call reads at the top of this method) — if
   * non-null — always names a real, already-created instance, so terminating
   * it is always terminating something real, never air. There is no window
   * left for a terminate to race a not-yet-created id, so no reconciliation
   * step is needed after the CAS either.
   *
   * The tradeoff: every call now unconditionally creates an instance before
   * it knows whether it will win the race for "current". A call that loses
   * (or can't tell whether it won — see `wonRace` below) must terminate the
   * instance it just created, purely for itself — a wasted create+terminate
   * pair. That's strictly worse than the old code's "loser skips `create()`
   * entirely" in the case both calls read the SAME `recorded` value
   * (previously zero wasted creates; now one), but the old code did not
   * actually cover the sequential case at all, so this trades a small,
   * bounded, always-safe cost for closing the gap the probe found.
   *
   * Concurrency, same-`recorded` race: two `restartToday` calls that read the
   * identical `recorded` value both create their own new id, then both
   * attempt `setCurrentIfMatch(..., expected: recorded, ...)`.
   * `pointerStore.setCurrentIfMatch` is a compare-and-swap (a single atomic
   * SQL statement, not a read-then-write from this class), so only one swap
   * can succeed. The winner terminates `recorded` (guaranteed real, by the
   * invariant above) and the loser terminates the id it just created for
   * itself (guaranteed real too — it made it, nobody else could have raced
   * it, `newId` is a fresh `randomUUID`).
   *
   * Concurrency, sequential race (what the probe forced): call A creates
   * `newIdA`, then wins its CAS — the pointer now names `newIdA`, and by
   * construction `newIdA` already exists at that moment (create ran first).
   * Call B can start any time after that, read `recorded = newIdA`
   * (legitimately — A really did commit it, and it is really real), create
   * its own `newIdB`, and win ITS CAS against `expected: newIdA`. B then
   * terminates `newIdA` — which exists, so this is a real termination, not a
   * no-op — and A never gets a say (A already returned once its own CAS
   * resolved; there is nothing left for A to do). Exactly one instance
   * (`newIdB`) survives. This is the regression test for the exact
   * interleaving the walker's probe constructed:
   * `workflows-care-day-instance-manager.test.ts`'s "a later restartToday
   * that starts after this call's CAS has committed, but finishes before
   * this call's own create() would have, still leaves exactly one instance
   * running" (mutation-verified: reverting to CAS-before-create turns it
   * red).
   *
   * `wonRace` defaults to `false` (treat as "lost"), not `true`: an
   * unverifiable CAS (the store call itself throws) must not be assumed to
   * have succeeded, because assuming success when it actually failed would
   * leave the instance we just created live with no pointer naming it — the
   * original bug. The cost of guessing wrong the other way (assuming loss
   * when the CAS actually landed) is bounded and self-healing: we terminate
   * the very instance the pointer now (unknowably, to us) names, so for a
   * short window NO instance is current for this user/day (residual risk,
   * see design.md) — the next `restartToday` (or the daily Cron's
   * `ensureFor` repair pass within 24h) reads that dead id back out,
   * terminates it (a harmless no-op), and creates a fresh one. The
   * alternative (assume win, skip the self-terminate) risks a permanent
   * orphan instead of a temporary gap — an orphan never self-heals, since
   * nothing will ever again derive its id to look it up. A temporary gap in
   * coverage is the strictly safer failure mode.
   *
   * Whole method is best-effort (design.md "即時生效機制"): every failure is
   * caught and logged, never thrown — the daily cron and the instance's own
   * midnight self-spawn are the durable paths, so a failure here costs at
   * most today's remaining latency.
   */
  async restartToday(userId: string, localDate: string): Promise<void> {
    const deterministicId = careDayInstanceId(userId, localDate);

    let recorded: string | null = null;
    try {
      recorded = await this.pointerStore.getCurrent(userId, localDate);
    } catch (err) {
      // Degrade to "no recorded instance" (recorded = null). Worst case, a
      // pointer row for today already exists and this read just couldn't see
      // it: the CAS below then races against a STALE `expected: null` and
      // loses (since the real row is non-null) — this call falls into the
      // "lost the race" branch and terminates only the instance it just
      // created for itself, leaving the actually-current instance untouched
      // and running. Unlike the pre-this-round version, this is NOT a
      // complete no-op: `create()` still runs (harmlessly wasted), and more
      // importantly the currently-running instance is never mistakenly
      // terminated either (it was never read, so it's never named in a
      // terminate call at all). Costs latency only.
      console.error("restartToday: pointerStore.getCurrent failed", describeErrorChain(err));
    }

    const newId = `${deterministicId}_r${crypto.randomUUID()}`;
    try {
      const timezone = await this.resolveTimezone(userId);
      await this.workflow.create({ id: newId, params: { userId, localDate, timezone } });
    } catch (err) {
      // create() itself failed: nothing was created, so there is nothing to
      // terminate and no pointer write to attempt. Whatever was previously
      // current (`recorded`, or the deterministic id) is untouched and keeps
      // running.
      console.error("restartToday: workflow.create failed", describeErrorChain(err));
      return;
    }

    let wonRace = false;
    try {
      wonRace = await this.pointerStore.setCurrentIfMatch(userId, localDate, recorded, newId);
    } catch (err) {
      console.error("restartToday: pointerStore.setCurrentIfMatch failed", describeErrorChain(err));
    }

    if (!wonRace) {
      // Lost the race, or the CAS couldn't be verified: `newId` is ours
      // alone (nobody else could have raced a freshly generated `randomUUID`
      // for it), so terminating it is always safe and always real.
      try {
        await (await this.workflow.get(newId)).terminate();
      } catch {
        // Already gone somehow — fine, best-effort.
      }
      return;
    }

    // Won: the pointer now names `newId`, an id we already know exists (we
    // just created it, and only got here because that create() resolved).
    // By the invariant this ordering establishes, `recorded` — the value we
    // just displaced — was itself created by whichever call's CAS wrote it
    // (this call's own read, or inductively an earlier winner's), so it is
    // always real too.
    if (recorded) {
      // If this request is interrupted anywhere between the CAS above
      // committing and this terminate() resolving (e.g. a Workers CPU-limit
      // cutoff — see PR #97), `recorded` becomes a permanent orphan: the
      // pointer has already moved past it, so no future call ever reads it
      // again to retry the cleanup. Accepted as residual risk (d) in
      // design.md — not covered by an automated repair pass yet.
      try {
        await (await this.workflow.get(recorded)).terminate();
      } catch {
        // Already terminated/finished — fine.
      }
    }
    if (deterministicId !== recorded) {
      // The daily Cron's `ensureFor` (or the day's very first instance)
      // uses the deterministic id directly and never touches the pointer —
      // clean it up too, whenever it isn't the id we just terminated above.
      try {
        await (await this.workflow.get(deterministicId)).terminate();
      } catch {
        // No existing deterministic instance to terminate (or it already finished) — fine.
      }
    }
  }
}
