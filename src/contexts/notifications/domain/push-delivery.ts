/** One attempted push for one occurrence and one device, registered before the send — a row exists even when the send fails, including when no HTTP request is made at all. */
export interface PushDeliveryRegistration {
  careOccurrenceId: string;
  pushSubscriptionId: string;
  /** `hashAckToken(token)` — never the token itself. */
  tokenHash: string;
  sentAt: Date;
  /** `sentAt + ttlSeconds`: past this instant the push service must no longer deliver it (RFC8030 5.2), so an ack claiming to be for it is not believable. */
  expiresAt: Date;
}

export interface PushDeliveryRepository {
  /**
   * Records the sends of one round BEFORE they go out, so an ack can never
   * arrive with no row to land on (a device can be handed the payload and
   * answer before this process gets to its own bookkeeping).
   */
  registerSent(rows: PushDeliveryRegistration[]): Promise<void>;
  /**
   * Marks the one row whose `token_hash` matches as acked, iff it is not
   * already acked and has not expired. Returns whether a row changed —
   * callers deliberately do not turn that into a response distinction, so the
   * unauthenticated endpoint offers no guess-the-token oracle.
   */
  markAcked(tokenHash: string, now: Date): Promise<boolean>;
}
