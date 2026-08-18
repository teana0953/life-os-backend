import { beforeEach, describe, expect, it } from "vitest";
import { sendTestPush, TEST_MESSAGE } from "../../../../src/contexts/notifications/application/send-test-push";
import { createWebPushProbe } from "../../../helpers/web-push-probe";
import { subscribeWebPush } from "../../../../src/contexts/notifications/application/subscribe-web-push";
import type {
  PushMessage,
  PushSendResult,
  PushSender,
} from "../../../../src/contexts/notifications/domain/push-sender";
import type { PushSubscription, PushSubscriptionRepository, PushSubscriptionKeys } from "../../../../src/contexts/notifications/domain/push-subscription";

class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private byEndpoint = new Map<string, PushSubscription>();

  async upsert(subscription: PushSubscriptionKeys): Promise<PushSubscription> {
    // The real repository upserts on `endpoint` and leaves the existing row's
    // `id` alone, so a re-subscribe from the same device keeps its identity.
    // Reusing a stored id here reproduces that; minting a fresh one every time
    // would make `push_delivery` rows look like they came from new devices.
    const stored = { id: this.byEndpoint.get(subscription.endpoint)?.id ?? `sub-${this.byEndpoint.size + 1}`, ...subscription };
    this.byEndpoint.set(subscription.endpoint, stored);
    return stored;
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    return [...this.byEndpoint.values()].filter((s) => s.userId === userId);
  }

  async deleteByEndpoint(userId: string, endpoint: string): Promise<void> {
    const existing = this.byEndpoint.get(endpoint);
    if (existing && existing.userId === userId) this.byEndpoint.delete(endpoint);
  }
}

/** Scriptable fake: returns results from `resultByEndpoint`, defaulting to "sent". */
class ScriptedPushSender implements PushSender {
  resultByEndpoint = new Map<string, PushSendResult>();
  sentTo: string[] = [];
  messages: PushMessage[] = [];

  async send(subscription: PushSubscriptionKeys, message: PushMessage): Promise<PushSendResult> {
    this.sentTo.push(subscription.endpoint);
    this.messages.push(message);
    return this.resultByEndpoint.get(subscription.endpoint) ?? { outcome: "sent" };
  }
}

let repo: InMemoryPushSubscriptionRepository;
let sender: ScriptedPushSender;

beforeEach(() => {
  repo = new InMemoryPushSubscriptionRepository();
  sender = new ScriptedPushSender();
});

describe("sendTestPush", () => {
  it("sends to every subscription of the user and reports sent/failed counts", async () => {
    await subscribeWebPush(repo, { userId: "user-1", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });
    await subscribeWebPush(repo, { userId: "user-1", endpoint: "https://push.example.com/b", p256dh: "k", auth: "a" });

    const result = await sendTestPush(repo, sender, "user-1");

    expect(result).toEqual({ sent: 2, failed: 0, errors: [] });
    expect(sender.sentTo.sort()).toEqual(["https://push.example.com/a", "https://push.example.com/b"]);
  });

  it("deletes a subscription the sender reports expired, and counts it as failed", async () => {
    await subscribeWebPush(repo, { userId: "user-1", endpoint: "https://push.example.com/gone", p256dh: "k", auth: "a" });
    sender.resultByEndpoint.set("https://push.example.com/gone", { outcome: "expired", detail: "status_410" });

    const result = await sendTestPush(repo, sender, "user-1");

    expect(result).toEqual({ sent: 0, failed: 1, errors: ["status_410"] });
    expect(await repo.listByUser("user-1")).toEqual([]);
  });

  it("keeps a subscription that merely failed transiently, and collects its error detail", async () => {
    await subscribeWebPush(repo, { userId: "user-1", endpoint: "https://push.example.com/flaky", p256dh: "k", auth: "a" });
    sender.resultByEndpoint.set("https://push.example.com/flaky", { outcome: "failed", detail: "status_500" });

    const result = await sendTestPush(repo, sender, "user-1");

    expect(result).toEqual({ sent: 0, failed: 1, errors: ["status_500"] });
    expect(await repo.listByUser("user-1")).toHaveLength(1);
  });

  it("sends the fixed generic test message (no personal data)", async () => {
    await subscribeWebPush(repo, { userId: "user-1", endpoint: "https://push.example.com/a", p256dh: "k", auth: "a" });
    await subscribeWebPush(repo, { userId: "user-1", endpoint: "https://push.example.com/b", p256dh: "k", auth: "a" });

    await sendTestPush(repo, sender, "user-1");

    // Every push carries exactly the fixed constant — guards against a future
    // change interpolating any user data into the payload.
    expect(sender.messages).toEqual([TEST_MESSAGE, TEST_MESSAGE]);
  });

  it("returns zero counts when the user has no subscriptions", async () => {
    const result = await sendTestPush(repo, sender, "user-1");

    expect(result).toEqual({ sent: 0, failed: 0, errors: [] });
  });
});

describe("sendTestPush: what reaches the push service", () => {
  it("puts the test push on the wire with TTL 60 and Urgency high, and no ack token", async () => {
    // "I pressed the button, does my phone light up now": a test push that
    // survives longer than the user stays on the settings screen answers
    // nothing. And there is no occurrence to attribute it to, so it must carry
    // no `data.ack` — the service worker contract is "ack only when the payload
    // has one".
    const probe = await createWebPushProbe();
    const repository = new InMemoryPushSubscriptionRepository();
    await repository.upsert(probe.subscription);

    const result = await sendTestPush(repository, probe.sender, "user-1");

    expect(result.sent).toBe(1);
    const headers = new Headers(probe.requests[0].headers);
    expect(headers.get("TTL")).toBe("60");
    expect(headers.get("Urgency")).toBe("high");
    expect(TEST_MESSAGE.data).toBeUndefined();
  });
});
