export interface PushSubscription {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRepository {
  /** Upsert semantics, keyed by `endpoint` (D5: a push endpoint is globally unique to one browser subscription). */
  upsert(subscription: PushSubscription): Promise<PushSubscription>;
  listByUser(userId: string): Promise<PushSubscription[]>;
  /** Idempotent: removing a non-existent endpoint is a silent no-op. */
  deleteByEndpoint(userId: string, endpoint: string): Promise<void>;
}
