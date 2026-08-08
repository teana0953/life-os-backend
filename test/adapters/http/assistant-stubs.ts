import type { ModelClient } from "../../../src/contexts/assistant/domain/model-client";

/** Stub for route tests that never touch the assistant endpoint (see assistant.test.ts for the scripted fake). */
export const stubModelClient: ModelClient = {
  turn: () => {
    throw new Error("not implemented in this test's fakes");
  },
};
