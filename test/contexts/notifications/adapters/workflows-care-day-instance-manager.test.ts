import { describe, expect, it, vi } from "vitest";
import { WorkflowsCareDayInstanceManager } from "../../../../src/contexts/notifications/adapters/workflows-care-day-instance-manager";
import type { UserRepository } from "../../../../src/contexts/user/domain/user-repository";
import { StrictWorkflowBinding } from "./strict-workflows-fakes";

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
  it("ensureToday: creates with an id matching Cloudflare's allowed format", async () => {
    const workflow = new StrictWorkflowBinding();
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());

    await manager.ensureToday(USER_ID, LOCAL_DATE);

    expect(workflow.createCalls).toHaveLength(1);
    const id = workflow.createCalls[0];
    expect(id).toMatch(VALID_WORKFLOW_ID);
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it("ensureToday and restartToday derive the id from userId and localDate (not a constant)", async () => {
    const workflow = new StrictWorkflowBinding();
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());

    await manager.ensureToday(USER_ID, LOCAL_DATE);
    await manager.restartToday(USER_ID, LOCAL_DATE);

    for (const id of workflow.createCalls) {
      expect(id).toContain(USER_ID);
      expect(id).toContain(LOCAL_DATE);
    }
  });

  it("ensureToday: logs (does not throw) when workflow.create fails", async () => {
    const workflow = new StrictWorkflowBinding();
    await workflow.create({ id: DETERMINISTIC_ID, params: {} }); // pre-occupy the id.
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Second ensureToday for the same (user, day): the deterministic id already
    // exists — the strict binding's create() must reject the collision.
    await expect(manager.ensureToday(USER_ID, LOCAL_DATE)).resolves.toBeUndefined();

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
      await workflow.create({ id: DETERMINISTIC_ID, params: {} }); // e.g. created earlier by ensureToday/the daily cron.
      const terminateSpy = vi.fn(async () => {});
      workflow.get = async () => ({ terminate: terminateSpy });
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());

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
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());

      await manager.restartToday(USER_ID, LOCAL_DATE);
      await manager.restartToday(USER_ID, LOCAL_DATE);

      // seed + 2 successful restarts = 3 distinct ids ever created.
      expect(workflow.createCalls).toHaveLength(3);
      expect(new Set(workflow.createCalls).size).toBe(3);
    });

    it("restartToday: creates with an id matching Cloudflare's allowed format even with no prior instance", async () => {
      const workflow = new StrictWorkflowBinding();
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());

      await manager.restartToday(USER_ID, LOCAL_DATE);

      expect(workflow.createCalls).toHaveLength(1);
      const id = workflow.createCalls[0];
      expect(id).toMatch(VALID_WORKFLOW_ID);
      expect(id.length).toBeLessThanOrEqual(100);
    });

    it("logs (does not throw) if workflow.create still fails for some other reason", async () => {
      const workflow = new StrictWorkflowBinding();
      const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());
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
