import { describe, expect, it } from "vitest";
import { recordPushAck } from "../../../../src/contexts/notifications/application/record-push-ack";
import { hashAckToken, mintAckToken } from "../../../../src/contexts/notifications/domain/ack-token";
import type { PushDeliveryRepository } from "../../../../src/contexts/notifications/domain/push-delivery";

const NOW = new Date("2026-08-18T09:00:00Z");

function recordingRepository(): PushDeliveryRepository & { acked: string[] } {
  const acked: string[] = [];
  return {
    acked,
    registerSent: async () => {},
    markAcked: async (tokenHash) => {
      acked.push(tokenHash);
      return true;
    },
  };
}

/** Any repository call at all is a failure for the shape-check cases below. */
const explodingRepository: PushDeliveryRepository = {
  registerSent: async () => {
    throw new Error("registerSent must not be reached");
  },
  markAcked: async () => {
    throw new Error("markAcked must not be reached for a token that never had the right shape");
  },
};

describe("recordPushAck", () => {
  it("looks the ack up by the token's hash, never by the token itself", async () => {
    const repository = recordingRepository();
    const token = mintAckToken();

    await recordPushAck(repository, token, NOW);

    expect(repository.acked).toEqual([await hashAckToken(token)]);
    expect(repository.acked[0]).not.toBe(token);
  });

  it.each([
    ["a token one character too short", "a".repeat(42)],
    ["a token one character too long", "a".repeat(44)],
    ["a right-length token with a character outside base64url", `${"a".repeat(42)}+`],
    ["an empty string", ""],
    ["a missing field", undefined],
    ["a non-string", { ack: 1 }],
  ])("does no database work for %s", async (_label, token) => {
    // The endpoint is unauthenticated, so junk traffic must cost zero queries:
    // Neon compute is metered and this repo has already exhausted a month of it
    // on a hot path. The exploding repository is what makes "no DB work" an
    // assertion rather than a hope.
    await expect(recordPushAck(explodingRepository, token, NOW)).resolves.toBeUndefined();
  });

  it("reveals nothing about whether the token matched", async () => {
    // The one entry point Firebase does not guard must not answer "is this
    // token real?", so the repository's boolean is deliberately dropped.
    let matchedCalled = false;
    let unmatchedCalled = false;
    const matched: PushDeliveryRepository = {
      registerSent: async () => {},
      markAcked: async () => {
        matchedCalled = true;
        return true;
      },
    };
    const unmatched: PushDeliveryRepository = {
      registerSent: async () => {},
      markAcked: async () => {
        unmatchedCalled = true;
        return false;
      },
    };

    // Both repositories must actually have been consulted, or the pair below
    // would be two identical no-ops rather than two opposite verdicts.
    expect(await recordPushAck(matched, mintAckToken(), NOW)).toBeUndefined();
    expect(await recordPushAck(unmatched, mintAckToken(), NOW)).toBeUndefined();
    expect([matchedCalled, unmatchedCalled]).toEqual([true, true]);
  });
});
