import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { pushDelivery } from "../../../shared/db/schema";
import type { PushDeliveryRegistration, PushDeliveryRepository } from "../domain/push-delivery";

export class DrizzlePushDeliveryRepository implements PushDeliveryRepository {
  constructor(private readonly getDb: () => Db) {}

  async registerSent(rows: PushDeliveryRegistration[]): Promise<void> {
    if (rows.length === 0) return;
    await this.getDb().insert(pushDelivery).values(rows);
  }

  /**
   * The whole authorization decision for the one unauthenticated endpoint in
   * this API is these three conditions, in SQL — never a read-then-write:
   * `token_hash` (this is the message we sent, to that device), `acked_at IS
   * NULL` (first ack wins; a replayed one changes nothing), `expires_at > now`
   * (the push service was no longer allowed to deliver it, so this ack cannot
   * be honest). A hand-rolled equivalent in TypeScript would be a lost update
   * under concurrency and, worse, would answer "does this token exist?" out
   * loud.
   */
  async markAcked(tokenHash: string, now: Date): Promise<boolean> {
    const updated = await this.getDb()
      .update(pushDelivery)
      .set({ ackedAt: now })
      .where(and(eq(pushDelivery.tokenHash, tokenHash), isNull(pushDelivery.ackedAt), gt(pushDelivery.expiresAt, now)))
      .returning({ id: pushDelivery.id });
    return updated.length > 0;
  }
}
