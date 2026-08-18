import type { Context } from "hono";
import { recordPushAck } from "../../../contexts/notifications/application/record-push-ack";
import type { PushDeliveryRepository } from "../../../contexts/notifications/domain/push-delivery";

/**
 * A generous ceiling on a body whose only legal content is `{"ack":"<43
 * chars>"}` (~55 bytes). Anything larger is discarded unparsed: this endpoint
 * is unauthenticated, so it must never do work proportional to what a stranger
 * sends.
 */
const MAX_ACK_BODY_BYTES = 1024;

/**
 * `POST /api/push/ack` — the ONLY route under `/api/` with no
 * `authMiddleware`. It cannot have one: the service worker sends this while
 * the app is closed, when no Firebase ID token exists anywhere it can reach.
 * The one-time token inside the (end-to-end encrypted) push payload is the
 * credential instead.
 *
 * Always 204, for every input — valid, malformed, expired, replayed. The
 * uniform answer is the point: a status that varied would let anyone probe
 * whether a token exists. Nothing on this path is logged, either; the token is
 * a bearer capability and this repo just finished keeping such values out of
 * its logs (PR #107).
 *
 * Read `{"ack": "..."}` from the body rather than a path segment for the same
 * reason: a capability URL would be copied into Cloudflare's request logs and
 * any intermediary's access log by construction.
 */
export function createPushAckHandler(options: { pushDeliveryRepository: PushDeliveryRepository; now?: () => Date }) {
  return async (c: Context) => {
    // Checked BEFORE `text()`, which would otherwise buffer and UTF-16-decode
    // the whole body first — the "discarded unparsed" property only holds if
    // the declared length is consulted first. A body with no (or a lying)
    // Content-Length still gets the post-buffer check below.
    const declared = Number(c.req.header("content-length"));
    if (Number.isFinite(declared) && declared > MAX_ACK_BODY_BYTES) return c.body(null, 204);

    const raw = await c.req.text();
    // `length` counts UTF-16 code units, which is never more than the UTF-8
    // byte count, so exceeding the cap here always means the body exceeded it
    // in bytes too. Conservative in the safe direction, and it avoids
    // re-encoding the string just to measure it.
    if (raw.length > MAX_ACK_BODY_BYTES) return c.body(null, 204);

    let ack: unknown;
    try {
      ack = (JSON.parse(raw) as { ack?: unknown }).ack;
    } catch {
      return c.body(null, 204);
    }

    await recordPushAck(options.pushDeliveryRepository, ack, options.now?.() ?? new Date());
    return c.body(null, 204);
  };
}
