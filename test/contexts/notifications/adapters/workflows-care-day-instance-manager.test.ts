import { describe, expect, it, vi } from "vitest";
import { WorkflowsCareDayInstanceManager } from "../../../../src/contexts/notifications/adapters/workflows-care-day-instance-manager";
import type { UserRepository } from "../../../../src/contexts/user/domain/user-repository";

// Cloudflare Workflows instance ids must match this pattern (own copy — never
// import the production regex, so a mutation that silently breaks the real
// id format is still caught by an independent check).
const VALID_WORKFLOW_ID = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/;

const USER_ID = "3f2b1c4a-5d6e-7f80-9a1b-2c3d4e5f6071";
const LOCAL_DATE = "2026-08-12";

function fakeUserRepository(): Pick<UserRepository, "getById"> {
  return {
    getById: async () => ({ id: USER_ID, timezone: "Asia/Taipei" }) as never,
  };
}

function fakeWorkflow(opts: { createShouldThrow?: boolean } = {}) {
  const createCalls: unknown[] = [];
  const workflow = {
    create: vi.fn(async (opts2: { id: string; params: unknown }) => {
      createCalls.push(opts2.id);
      if (opts.createShouldThrow) throw new Error("boom: id collision or API failure");
      return {} as never;
    }),
    get: vi.fn(async () => {
      throw new Error("no such instance");
    }),
  };
  return { workflow, createCalls };
}

describe("WorkflowsCareDayInstanceManager", () => {
  it("ensureToday: creates with an id matching Cloudflare's allowed format", async () => {
    const { workflow, createCalls } = fakeWorkflow();
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());

    await manager.ensureToday(USER_ID, LOCAL_DATE);

    expect(createCalls).toHaveLength(1);
    const id = createCalls[0] as string;
    expect(id).toMatch(VALID_WORKFLOW_ID);
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it("restartToday: creates with an id matching Cloudflare's allowed format", async () => {
    const { workflow, createCalls } = fakeWorkflow();
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());

    await manager.restartToday(USER_ID, LOCAL_DATE);

    expect(createCalls).toHaveLength(1);
    const id = createCalls[0] as string;
    expect(id).toMatch(VALID_WORKFLOW_ID);
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it("ensureToday and restartToday derive the id from userId and localDate (not a constant)", async () => {
    const { workflow, createCalls } = fakeWorkflow();
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());

    await manager.ensureToday(USER_ID, LOCAL_DATE);
    await manager.restartToday(USER_ID, LOCAL_DATE);

    for (const id of createCalls) {
      expect(id).toContain(USER_ID);
      expect(id).toContain(LOCAL_DATE);
    }
  });

  it("ensureToday: logs (does not throw) when workflow.create fails", async () => {
    const { workflow } = fakeWorkflow({ createShouldThrow: true });
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(manager.ensureToday(USER_ID, LOCAL_DATE)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("restartToday: logs (does not throw) when workflow.create fails", async () => {
    const { workflow } = fakeWorkflow({ createShouldThrow: true });
    const manager = new WorkflowsCareDayInstanceManager(workflow as never, fakeUserRepository());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(manager.restartToday(USER_ID, LOCAL_DATE)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
