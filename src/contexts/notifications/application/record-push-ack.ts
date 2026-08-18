import { ACK_TOKEN_PATTERN, hashAckToken } from "../domain/ack-token";
import type { PushDeliveryRepository } from "../domain/push-delivery";

/**
 * Use case behind the one unauthenticated route in this API: a service worker
 * reports that it received a push, proving which push by echoing the one-time
 * token that was inside its encrypted payload.
 *
 * Deliberately returns nothing. The repository knows whether a row changed,
 * but publishing that would turn the endpoint into an oracle for "is this
 * token real?", and it is the only entry point Firebase does not guard.
 *
 * Equally deliberately, this records a fact and changes no behaviour: it does
 * not stop a nag, does not reschedule, does not touch `care_occurrence`.
 * "The device received the message" is not "the user took the medication" —
 * `care_log` remains the only thing that ends a nag. Were an ack allowed to
 * silence a reminder, silencing a medication reminder would become an
 * unauthenticated capability.
 *
 * The shape check runs before any repository call so that garbage traffic
 * against a public endpoint costs zero database work (Neon compute is
 * metered, and this repo has already burned a month's budget on a hot path).
 */
export async function recordPushAck(repository: PushDeliveryRepository, token: unknown, now: Date): Promise<void> {
  if (typeof token !== "string" || !ACK_TOKEN_PATTERN.test(token)) return;
  await repository.markAcked(await hashAckToken(token), now);
}
