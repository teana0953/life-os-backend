import { and, eq } from "drizzle-orm";
import type { Db } from "../../../shared/db/client";
import { pushSubscription } from "../../../shared/db/schema";
import type { PushSubscription, PushSubscriptionRepository } from "../domain/push-subscription";

type PushSubscriptionRow = typeof pushSubscription.$inferSelect;

function toDomain(row: PushSubscriptionRow): PushSubscription {
  return { userId: row.userId, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth };
}

export class DrizzlePushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly getDb: () => Db) {}

  async upsert(subscription: PushSubscription): Promise<PushSubscription> {
    const db = this.getDb();
    const values = {
      userId: subscription.userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    };
    const [row] = await db
      .insert(pushSubscription)
      .values(values)
      .onConflictDoUpdate({ target: pushSubscription.endpoint, set: values })
      .returning();
    if (!row) throw new Error("failed to upsert push subscription");
    return toDomain(row);
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    const db = this.getDb();
    const rows = await db.select().from(pushSubscription).where(eq(pushSubscription.userId, userId));
    return rows.map(toDomain);
  }

  async deleteByEndpoint(userId: string, endpoint: string): Promise<void> {
    const db = this.getDb();
    await db
      .delete(pushSubscription)
      .where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));
  }
}
