import { describe, expect, it, vi } from "vitest";
import { WorkflowsCareDayInstanceManager } from "../../../../src/contexts/notifications/adapters/workflows-care-day-instance-manager";
import type { UserRepository } from "../../../../src/contexts/user/domain/user-repository";
import { InMemoryCareDayInstancePointerStore, StrictWorkflowBinding } from "./strict-workflows-fakes";

// Cloudflare Workflows instance ids must match this pattern (own copy — never
// import the production regex, so a mutation that silently breaks the real
// id format is still caught by an independent check).
const VALID_WORKFLOW_ID = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/;

const USER_ID = "3f2b1c4a-5d6e-7f80-9a1b-2c3d4e5f6071";
const LOCAL_DATE = "2026-08-12";
const DETERMINISTIC_ID = `care-day_${USER_ID}_${LOCAL_DATE}`;

function fakeUserRepository(): Pick<UserRepository, "getById"> {
  return {
    getById: async () => ({ id: USER_ID, timezone: "Asia/Taipei" }) as never,
  };
}

describe("WorkflowsCareDayInstanceManager", () => {
  it("ensureFor: creates with an id matching Cloudflare's allowed format", async () => {
    const workflow = new StrictWorkflowBinding();
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), new InMemoryCareDayInstancePointerStore());

    await manager.ensureFor(USER_ID, LOCAL_DATE);

    expect(workflow.createCalls).toHaveLength(1);
    const id = workflow.createCalls[0];
    expect(id).toMatch(VALID_WORKFLOW_ID);
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it("ensureFor and restartToday derive the id from userId and localDate (not a constant)", async () => {
    const workflow = new StrictWorkflowBinding();
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), new InMemoryCareDayInstancePointerStore());

    await manager.ensureFor(USER_ID, LOCAL_DATE);
    await manager.restartToday(USER_ID, LOCAL_DATE);

    for (const id of workflow.createCalls) {
      expect(id).toContain(USER_ID);
      expect(id).toContain(LOCAL_DATE);
    }
  });

  it("ensureFor: logs (does not throw) when workflow.create fails", async () => {
    const workflow = new StrictWorkflowBinding();
    await workflow.create({ id: DETERMINISTIC_ID, params: {} }); // pre-occupy the id.
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), new InMemoryCareDayInstancePointerStore());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Second ensureFor for the same (user, day): the deterministic id already
    // exists — the strict binding's create() must reject the collision.
    await expect(manager.ensureFor(USER_ID, LOCAL_DATE)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // Bug B (goal.md): `restartToday` used to terminate-then-create with the
  // SAME deterministic id, which the real Workflows API rejects for any id
  // used before, even a just-terminated one, within its retention window —
  // so create() always failed and got silently swallowed. This is
  // `WorkflowsCareDayInstanceManager`'s own regression test for that.
  describe("restartToday", () => {
    it("when today's deterministic instance already exists: terminates it, then SUCCEEDS at creating a fresh instance under a new id", async () => {
      const workflow = new StrictWorkflowBinding();
      await workflow.create({ id: DETERMINISTIC_ID, params: {} }); // e.g. created earlier by ensureFor/the daily cron.
      const terminateSpy = vi.fn(async () => {});
      workflow.get = async () => ({ terminate: terminateSpy });
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), new InMemoryCareDayInstancePointerStore());

      await manager.restartToday(USER_ID, LOCAL_DATE);

      expect(terminateSpy).toHaveBeenCalledTimes(1);
      // The load-bearing assertion (not merely "did not throw" — the old,
      // buggy code also silently caught its failure and returned
      // successfully): a SECOND instance was actually, successfully created.
      expect(workflow.createCalls).toHaveLength(2); // the pre-existing seed + this restart's new one.
      const newId = workflow.createCalls[1];
      expect(newId).not.toBe(DETERMINISTIC_ID);
      expect(newId).toMatch(VALID_WORKFLOW_ID);
      expect(newId.length).toBeLessThanOrEqual(100);
    });

    it("two consecutive restartToday calls produce two different new ids (no same-millisecond collision)", async () => {
      const workflow = new StrictWorkflowBinding();
      await workflow.create({ id: DETERMINISTIC_ID, params: {} });
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), new InMemoryCareDayInstancePointerStore());

      await manager.restartToday(USER_ID, LOCAL_DATE);
      await manager.restartToday(USER_ID, LOCAL_DATE);

      // seed + 2 successful restarts = 3 distinct ids ever created.
      expect(workflow.createCalls).toHaveLength(3);
      expect(new Set(workflow.createCalls).size).toBe(3);
    });

    // fix/restart-instance-tracking's core regression: PR #100 fixed
    // create()-always-fails, but restartToday still only ever knew how to
    // terminate the DETERMINISTIC id, never the `_r`-suffixed instance a
    // PRIOR restartToday had created — so the second restart onward left the
    // previous restart's instance running forever. The load-bearing
    // assertion is `runningIds()`, not `createCalls` — the old buggy code
    // also called `create()` the right number of times, it just never
    // terminated what it should have.
    it("three consecutive restartToday calls each terminate the PREVIOUS restart's instance — exactly one instance survives", async () => {
      const workflow = new StrictWorkflowBinding();
      await workflow.create({ id: DETERMINISTIC_ID, params: {} }); // e.g. seeded by the daily cron.
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), new InMemoryCareDayInstancePointerStore());

      await manager.restartToday(USER_ID, LOCAL_DATE);
      expect(workflow.runningIds()).toEqual([workflow.createCalls[1]]); // deterministic seed terminated, first restart survives.

      await manager.restartToday(USER_ID, LOCAL_DATE);
      expect(workflow.runningIds()).toEqual([workflow.createCalls[2]]); // first restart's instance is now terminated too.

      await manager.restartToday(USER_ID, LOCAL_DATE);
      expect(workflow.runningIds()).toEqual([workflow.createCalls[3]]);

      expect(workflow.createCalls).toHaveLength(4); // seed + 3 restarts.
      expect(new Set(workflow.createCalls).size).toBe(4);
    });

    it("ignores a pointer recorded for a different (stale) local date: terminates the deterministic instance, not the stale id", async () => {
      const workflow = new StrictWorkflowBinding();
      await workflow.create({ id: DETERMINISTIC_ID, params: {} });
      const staleId = "care-day_stale-from-yesterday";
      await workflow.create({ id: staleId, params: {} });
      const pointerStore = new InMemoryCareDayInstancePointerStore();
      await pointerStore.setCurrentIfMatch(USER_ID, "2026-08-11", null, staleId); // yesterday's pointer.
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), pointerStore);

      await manager.restartToday(USER_ID, LOCAL_DATE);

      // The stale (yesterday's) instance is untouched; only today's deterministic one was terminated.
      expect(workflow.runningIds().sort()).toEqual([staleId, workflow.createCalls[workflow.createCalls.length - 1]].sort());
      expect(await pointerStore.getCurrent(USER_ID, LOCAL_DATE)).toBe(workflow.createCalls[workflow.createCalls.length - 1]);
    });

    it("degrades gracefully (does not throw, still restarts) when pointerStore.getCurrent fails", async () => {
      const workflow = new StrictWorkflowBinding();
      await workflow.create({ id: DETERMINISTIC_ID, params: {} });
      const pointerStore = new InMemoryCareDayInstancePointerStore();
      pointerStore.getCurrent = async () => {
        throw new Error("boom: DB unreachable");
      };
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), pointerStore);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(manager.restartToday(USER_ID, LOCAL_DATE)).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
      // Still terminated the deterministic instance and created a fresh one — a
      // read failure must not silently do nothing.
      expect(workflow.createCalls).toHaveLength(2);
      errorSpy.mockRestore();
    });

    // Ordering guard, 2nd round (fix/restart-instance-tracking follow-up):
    // `create()` must run BEFORE the pointer is ever written to the new id —
    // the reverse of the round-1 fix. The round-1 order (CAS-write, then
    // create) let the pointer briefly name an instance that did not exist
    // yet, which a concurrent call could observe and act on; a probe test
    // forcing that exact interleaving produced two live instances (see the
    // concurrency test below). This test pins the NEW invariant directly: a
    // create() failure must leave the previously-current instance and the
    // pointer completely untouched — not "pointer moved, but nothing was
    // created" (round-1's shape) and not "old instance already terminated,
    // new one failed to create" (which the pre-round-1 code would have done,
    // since it terminated before ever attempting create()).
    it("calls workflow.create BEFORE writing the pointer — a create() failure leaves the pointer, and the previously-current instance, completely untouched", async () => {
      const workflow = new StrictWorkflowBinding();
      const pointerStore = new InMemoryCareDayInstancePointerStore();
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), pointerStore);

      // Establish a real "previously current" instance via a normal restart.
      await manager.restartToday(USER_ID, LOCAL_DATE);
      const priorId = await pointerStore.getCurrent(USER_ID, LOCAL_DATE);
      expect(priorId).toBeDefined();
      expect(workflow.runningIds()).toEqual([priorId]);

      workflow.create = async () => {
        throw new Error("boom: create failed");
      };
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await manager.restartToday(USER_ID, LOCAL_DATE);

      // Pointer is untouched — still names the prior instance, not a fresh
      // (never-created) id.
      expect(await pointerStore.getCurrent(USER_ID, LOCAL_DATE)).toBe(priorId);
      // The prior instance was never preemptively terminated either — it's
      // still the only thing running.
      expect(workflow.runningIds()).toEqual([priorId]);
      errorSpy.mockRestore();
    });

    // The other half of the create-before-CAS ordering: if the pointer WRITE
    // itself fails (or can't be verified), create() has already happened by
    // then — so this restart's own instance must be torn back down again,
    // rather than left running untracked (the original bug, reached via an
    // unverifiable CAS instead of a lost race).
    it("still calls workflow.create when pointerStore.setCurrentIfMatch fails, but immediately terminates the instance it just created (an unverifiable CAS is treated as a loss)", async () => {
      const workflow = new StrictWorkflowBinding();
      await workflow.create({ id: DETERMINISTIC_ID, params: {} });
      const pointerStore = new InMemoryCareDayInstancePointerStore();
      pointerStore.setCurrentIfMatch = async () => {
        throw new Error("boom: DB unreachable");
      };
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), pointerStore);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(manager.restartToday(USER_ID, LOCAL_DATE)).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
      // create() DID run (new ordering) — but since the CAS is unverifiable,
      // the instance it just created is torn down again immediately.
      expect(workflow.createCalls).toHaveLength(2);
      expect(workflow.runningIds()).toEqual([DETERMINISTIC_ID]); // only the pre-existing seed survives.
      errorSpy.mockRestore();
    });

    // Concurrency guard (GATE requirement): two simultaneous restartToday
    // calls must leave exactly ONE instance running, never two. This forces
    // the worst-case interleaving — both calls read the SAME `recorded`
    // pointer state before either writes — via a barrier on
    // pointerStore.getCurrent, rather than hoping Promise.all happens to
    // schedule that way. The invariant checked is a COUNT
    // (`runningIds().length === 1`), not "which one survived" — deliberately
    // not pinned to one particular interleaving (this repo's recorded lesson
    // about concurrency guards that only prove the one interleaving the test
    // happened to construct).
    it("two concurrent restartToday calls (forced to read the same pointer state) leave exactly one instance running", async () => {
      const workflow = new StrictWorkflowBinding();
      await workflow.create({ id: DETERMINISTIC_ID, params: {} });
      const pointerStore = new InMemoryCareDayInstancePointerStore();
      let arrivals = 0;
      let releaseBoth: () => void;
      const bothArrived = new Promise<void>((resolve) => {
        releaseBoth = resolve;
      });
      const realGetCurrent = pointerStore.getCurrent.bind(pointerStore);
      pointerStore.getCurrent = async (userId: string, localDate: string) => {
        arrivals++;
        if (arrivals >= 2) releaseBoth();
        await bothArrived; // both callers block here until both have arrived, then proceed together.
        return realGetCurrent(userId, localDate);
      };
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), pointerStore);

      await Promise.all([manager.restartToday(USER_ID, LOCAL_DATE), manager.restartToday(USER_ID, LOCAL_DATE)]);

      expect(workflow.runningIds()).toHaveLength(1);
    });

    // fix/restart-instance-tracking, 2nd round: under the CURRENT (create-
    // before-CAS) ordering there is no separate "reconciliation" step — a
    // call whose own `create()` is slow simply loses its CAS naturally once
    // a later call has already claimed "current" out from under the
    // `expected` value it read, and treats that loss the same as any other:
    // terminate the instance it just created for itself. This test forces
    // exactly that: call A's `create()` is blocked while call B reads the
    // SAME pointer state A read, runs to completion, and claims "current"
    // first — so when A's blocked `create()` finally resolves and A attempts
    // its own CAS, it loses (the pointer no longer matches what A read) and
    // tears itself back down. (An earlier version of this fix used the
    // opposite order — CAS before create, with a post-create "reconciliation"
    // check — and needed this exact interleaving, plus a second forced pause
    // on B's own CAS, to prove sound; a probe test found a further
    // interleaving where even that reconciliation check still let two
    // instances survive. This ordering removes the class of bug entirely
    // rather than patching around another instance of it — see
    // `workflows-care-day-instance-manager.ts`'s `restartToday` doc comment.)
    it("a restart whose own create() is slow loses its CAS to a later restart that finished first, and tears its own (unclaimed) instance back down — no orphan", async () => {
      const workflow = new StrictWorkflowBinding();
      await workflow.create({ id: DETERMINISTIC_ID, params: {} });
      const pointerStore = new InMemoryCareDayInstancePointerStore();
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), pointerStore);

      const realCreate = workflow.create.bind(workflow);
      let releaseFirstCreate: () => void;
      const firstCreateGate = new Promise<void>((resolve) => {
        releaseFirstCreate = resolve;
      });
      let resolveEntered: () => void;
      const entered = new Promise<void>((resolve) => {
        resolveEntered = resolve;
      });
      let gated = false;
      workflow.create = async (opts: { id: string; params: unknown }) => {
        if (!gated && opts.id !== DETERMINISTIC_ID) {
          gated = true;
          resolveEntered();
          await firstCreateGate; // block the FIRST restart's create() until told to proceed.
        }
        return realCreate(opts);
      };

      // Call A: its pointer CAS commits, then it blocks inside its own create().
      const firstRestart = manager.restartToday(USER_ID, LOCAL_DATE);
      await entered;

      // Call B: runs to completion — reads A's already-committed pointer,
      // legitimately wins its own CAS against it, and creates its own instance.
      await manager.restartToday(USER_ID, LOCAL_DATE);

      // Now let A's create() resolve. It succeeds (distinct id), but A's
      // reconciliation check must notice it was superseded and terminate itself.
      releaseFirstCreate!();
      await firstRestart;

      expect(workflow.runningIds()).toHaveLength(1);
    });

    // Invariant, not a single enumerated interleaving (walker requirement,
    // round 2): the create-before-CAS ordering's whole claim is that ANY
    // call reading a non-null `recorded` value is reading an id that has
    // ALREADY been created — never a not-yet-real one. This test forces the
    // one place that claim is load-bearing: call B is made to read call A's
    // just-committed pointer, and to terminate what it names, WHILE call A
    // itself is still paused (delayed on the way back out of its own
    // already-resolved CAS, before A has run its own cleanup terminate()
    // calls) — so A's instance is real and running, and it is B, a
    // completely different call, that has to actually tear it down. Under
    // the round-1 (CAS-before-create) ordering the analogous window let a
    // later call's terminate() land on an id that was still mid-`create()` —
    // a silent no-op (see the probe interleaving referenced above). Here it
    // must be a REAL termination, and exactly one instance must survive
    // regardless of both calls' cleanup work overlapping.
    it("a later restartToday's terminate() of a just-superseded id is a REAL termination (not a no-op), even when it races the superseded call's own cleanup", async () => {
      const workflow = new StrictWorkflowBinding();
      const pointerStore = new InMemoryCareDayInstancePointerStore();
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), pointerStore);

      // Seed a "previously current" instance the same way a real prior
      // restartToday call would.
      await manager.restartToday(USER_ID, LOCAL_DATE);
      const seededId = await pointerStore.getCurrent(USER_ID, LOCAL_DATE);

      const realCas = pointerStore.setCurrentIfMatch.bind(pointerStore);
      let firstCasSeen = false;
      let resolveCommitted: () => void;
      const committed = new Promise<void>((resolve) => {
        resolveCommitted = resolve;
      });
      let releaseA: () => void;
      const aGate = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      pointerStore.setCurrentIfMatch = async (userId: string, localDate: string, expected: string | null, next: string) => {
        const won = await realCas(userId, localDate, expected, next);
        if (!firstCasSeen) {
          firstCasSeen = true;
          // A's CAS has now REALLY committed (the pointer already names
          // A's newId, and A's newId already exists — it was created
          // before this CAS ran) — but pause A here, before it runs its
          // own post-CAS terminate() calls.
          resolveCommitted();
          await aGate;
        }
        return won;
      };

      // Call A: reads `seededId`, creates its own id, wins its CAS, then
      // pauses (still holding onto its terminate-the-old-instance work).
      const a = manager.restartToday(USER_ID, LOCAL_DATE);
      await committed;
      const newIdA = workflow.createCalls[workflow.createCalls.length - 1];
      // A is paused BEFORE its own post-CAS cleanup (it has not yet
      // terminated `seededId`, the instance its own CAS just superseded) —
      // so at this instant all three of seededId, newIdA, and (once B
      // creates it) newIdB briefly coexist. That overlap is expected and
      // harmless; it is not the invariant under test here.
      expect(workflow.runningIds().sort()).toEqual([newIdA, seededId].sort()); // both real, both still running.

      // Call B: reads the pointer (= newIdA, already committed AND already
      // created), creates its own id, wins its own CAS, and terminates
      // newIdA for real. A's own cleanup of `seededId` is still pending
      // (A remains paused), so `seededId` is still running at this point —
      // the assertion below is specifically that newIdA (NOT seededId) was
      // torn down, and torn down for real rather than skipped as a no-op.
      const b = manager.restartToday(USER_ID, LOCAL_DATE);
      await b;
      const newIdB = workflow.createCalls[workflow.createCalls.length - 1];
      expect(workflow.runningIds().sort()).toEqual([seededId, newIdB].sort());

      // Resume A: it still terminates what IT thinks is stale (seededId,
      // and the deterministic id) — harmless, and does not resurrect newIdA
      // or disturb B's result.
      releaseA!();
      await a;

      expect(workflow.runningIds()).toEqual([newIdB]);
      expect(await pointerStore.getCurrent(USER_ID, LOCAL_DATE)).toBe(newIdB);
    });

    // Invariant sweep, unforced scheduling: rather than one hand-picked
    // interleaving, fire several concurrent restartToday calls with no
    // artificial gates at all and let the real Promise microtask scheduler
    // interleave their `getCurrent`/`create`/`setCurrentIfMatch` awaits
    // however it happens to — repeated across several fresh runs so this
    // isn't pinned to one particular schedule. The invariant checked is
    // always the same: at most one instance survives, and the pointer (if it
    // names anything) names a survivor.
    it("invariant sweep: any number of concurrent restartToday calls for the same (user, day) leave at most one instance running", async () => {
      for (let trial = 0; trial < 15; trial++) {
        const workflow = new StrictWorkflowBinding();
        await workflow.create({ id: DETERMINISTIC_ID, params: {} });
        const pointerStore = new InMemoryCareDayInstancePointerStore();
        const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), pointerStore);

        // Warm up the pointer with one prior restart first, so `recorded` is
        // non-null going into the concurrent batch below — otherwise every
        // trial starts from a fresh pointerStore and the four concurrent
        // calls below all read `recorded === null`, never exercising the
        // "winner terminates `recorded`" branch at all.
        await manager.restartToday(USER_ID, LOCAL_DATE);

        await Promise.all([
          manager.restartToday(USER_ID, LOCAL_DATE),
          manager.restartToday(USER_ID, LOCAL_DATE),
          manager.restartToday(USER_ID, LOCAL_DATE),
          manager.restartToday(USER_ID, LOCAL_DATE),
        ]);

        const running = workflow.runningIds();
        expect(running.length).toBeLessThanOrEqual(1);
        const pointer = await pointerStore.getCurrent(USER_ID, LOCAL_DATE);
        if (pointer !== null && running.length === 1) {
          expect(pointer).toBe(running[0]);
        }
      }
    });

    it("restartToday: creates with an id matching Cloudflare's allowed format even with no prior instance", async () => {
      const workflow = new StrictWorkflowBinding();
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), new InMemoryCareDayInstancePointerStore());

      await manager.restartToday(USER_ID, LOCAL_DATE);

      expect(workflow.createCalls).toHaveLength(1);
      const id = workflow.createCalls[0];
      expect(id).toMatch(VALID_WORKFLOW_ID);
      expect(id.length).toBeLessThanOrEqual(100);
    });

    it("logs (does not throw) if workflow.create still fails for some other reason", async () => {
      const workflow = new StrictWorkflowBinding();
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository(), new InMemoryCareDayInstancePointerStore());
      workflow.create = async () => {
        throw new Error("boom: some real Workflows API failure");
      };
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(manager.restartToday(USER_ID, LOCAL_DATE)).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});
