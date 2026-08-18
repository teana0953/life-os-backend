/** What a browser hands over when it subscribes — everything needed to encrypt and address one push. */
export interface PushSubscriptionKeys {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * A subscription as stored. `id` is the only stable, non-credential handle to a
 * device: `endpoint` also identifies it, but it carries the push token, so
 * anything that merely needs to say "which device" (e.g. `push_delivery`)
 * references `id` instead of copying the endpoint into another table.
 */
export interface PushSubscription extends PushSubscriptionKeys {
  id: string;
}

export interface PushSubscriptionRepository {
  /** Upsert semantics, keyed by `endpoint` (D5: a push endpoint is globally unique to one browser subscription). */
  upsert(subscription: PushSubscriptionKeys): Promise<PushSubscription>;
  listByUser(userId: string): Promise<PushSubscription[]>;
  /** Idempotent: removing a non-existent endpoint is a silent no-op. */
  deleteByEndpoint(userId: string, endpoint: string): Promise<void>;
}
