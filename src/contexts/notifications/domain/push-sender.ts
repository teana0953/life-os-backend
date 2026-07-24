import type { PushSubscription } from "./push-subscription";

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** `expired` = the push service reported the subscription gone (404/410), i.e. safe to delete. */
export type PushSendOutcome = "sent" | "expired" | "failed";

/**
 * `detail` is a short, non-credential diagnostic (e.g. `"status_500"`, `"network"`,
 * `"no_vapid_config"`) — never the subscription endpoint/keys or a VAPID secret.
 */
export interface PushSendResult {
  outcome: PushSendOutcome;
  detail?: string;
}

export interface PushSender {
  send(subscription: PushSubscription, message: PushMessage): Promise<PushSendResult>;
}
