import type { PushSubscription } from "./push-subscription";

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** `expired` = the push service reported the subscription gone (404/410), i.e. safe to delete. */
export type PushSendResult = "sent" | "expired" | "failed";

export interface PushSender {
  send(subscription: PushSubscription, message: PushMessage): Promise<PushSendResult>;
}
