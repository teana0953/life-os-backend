import type { PushSubscriptionKeys } from "./push-subscription";

/** RFC8030 5.3: the only four legal `Urgency` values; omitting the header is equivalent to `normal`. */
export type PushUrgency = "very-low" | "low" | "normal" | "high";

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /**
   * RFC8030 5.2 `TTL`, in seconds: once it elapses "the push service MUST NOT
   * attempt to deliver the push message". Deliberately required, with no
   * default here — every caller's value has a stated reason at the call site,
   * and a default would reintroduce a number nobody can account for.
   */
  ttlSeconds: number;
  /** Sent as the RFC8030 5.3 `Urgency` header only when set (see `PushUrgency`). */
  urgency?: PushUrgency;
}

/** `expired` = the push service reported the subscription gone (404/410), i.e. safe to delete. */
export type PushSendOutcome = "sent" | "expired" | "failed";

/**
 * `outcome: "sent"` means the push service accepted the message — nothing more.
 * FCM answers 201 with no delivery information (measured 2026-08-18 against a
 * real endpoint, including with RFC8030 5.1 `Prefer: respond-async`), so
 * whether a device ever received it is only knowable from a `push_delivery`
 * ack.
 *
 * `detail` is a short, non-credential diagnostic (e.g. `"status_500"`, `"network"`,
 * `"no_vapid_config"`) — never the subscription endpoint/keys or a VAPID secret.
 */
export interface PushSendResult {
  outcome: PushSendOutcome;
  detail?: string;
}

export interface PushSender {
  send(subscription: PushSubscriptionKeys, message: PushMessage): Promise<PushSendResult>;
}
