import type { Context } from "hono";
import { sendTestPush } from "../../../contexts/notifications/application/send-test-push";
import { subscribeWebPush } from "../../../contexts/notifications/application/subscribe-web-push";
import { unsubscribeWebPush } from "../../../contexts/notifications/application/unsubscribe-web-push";
import type { CareDayInstanceManager } from "../../../contexts/notifications/domain/care-day-instance";
import type { PushSender } from "../../../contexts/notifications/domain/push-sender";
import type { PushSubscriptionRepository } from "../../../contexts/notifications/domain/push-subscription";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { requireHttpsUrl, requireString } from "../validation";

export interface PushHandlerOptions {
  userRepository: UserRepository;
  pushSubscriptionRepository: PushSubscriptionRepository;
  pushSender: PushSender;
  vapidPublicKey: string;
  /** Optional: a new subscription best-effort restarts today's instance so a `no_subscriptions` slot delivers within seconds (key_decisions "即時生效機制"). */
  careDayInstanceManager?: CareDayInstanceManager;
}

/** Protected `GET /api/push/vapid-public-key`: the server's configured VAPID public key (empty string if unset). */
export function createGetVapidPublicKeyHandler(options: Pick<PushHandlerOptions, "vapidPublicKey">) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    return c.json({ public_key: options.vapidPublicKey });
  };
}

/** Protected `POST /api/push/subscribe`: register (or, on a repeat `endpoint`, replace) a Web Push subscription. */
export function createSubscribeWebPushHandler(
  options: Pick<PushHandlerOptions, "userRepository" | "pushSubscriptionRepository" | "careDayInstanceManager">,
) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    const notify = options.careDayInstanceManager
      ? { instanceManager: options.careDayInstanceManager, userRepository: options.userRepository }
      : undefined;
    const subscription = await subscribeWebPush(
      options.pushSubscriptionRepository,
      {
        userId,
        endpoint: requireHttpsUrl(body.endpoint, "endpoint"),
        p256dh: requireString(body.p256dh, "p256dh"),
        auth: requireString(body.auth, "auth"),
      },
      notify,
    );
    return c.json({ endpoint: subscription.endpoint });
  };
}

/** Protected `DELETE /api/push/subscribe`: remove a subscription by endpoint (idempotent). */
export function createUnsubscribeWebPushHandler(
  options: Pick<PushHandlerOptions, "userRepository" | "pushSubscriptionRepository">,
) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>();

    await unsubscribeWebPush(options.pushSubscriptionRepository, userId, requireString(body.endpoint, "endpoint"));
    return c.json({});
  };
}

/** Protected `POST /api/push/test`: send the fixed test message to every subscription the user has registered. */
export function createTestPushHandler(
  options: Pick<PushHandlerOptions, "userRepository" | "pushSubscriptionRepository" | "pushSender">,
) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const result = await sendTestPush(options.pushSubscriptionRepository, options.pushSender, userId);
    return c.json(result);
  };
}
