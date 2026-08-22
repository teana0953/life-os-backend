import type { Context } from "hono";
import { BadRequestError } from "../validation";

/**
 * Where the model API key comes from — **the only place that knows**.
 *
 * Everything downstream takes a key and cannot tell whether it arrived from
 * the caller or from the service's own settings. That is the whole point:
 * serving this feature from a key we own later is a change to this function
 * and nothing else (proposal, "為以後改成服務出錢留的唯一一個縫").
 *
 * Read from a **header**, never a query parameter. Query strings reach access
 * logs, `Referer` headers and browser history — and the provider's own
 * examples put the key there, which is exactly why this is written down.
 *
 * The key is used for the request and stored nowhere. Nothing here logs it,
 * and no response may contain it; a database breach is therefore not a key
 * breach, and the trust the caller extends is "do not misuse it now" rather
 * than "keep it safe forever".
 */
export const GEMINI_KEY_HEADER = "X-Gemini-Api-Key";

/**
 * Whether this request may reach health and diet records — a decision that
 * rides with the request rather than being stored, so consent lives on the same
 * device as the key it is spent through.
 *
 * Fail closed: only the exact value below turns it on. A typo, a different
 * casing, or a value some future client invents must not silently ship
 * menstrual and glucose records to a provider the caller never agreed to.
 *
 * `app.ts` must list this header in the CORS `allowHeaders`, or the browser
 * rejects the request before it leaves the client — a failure no server-side
 * test can see.
 */
export const ASSISTANT_HEALTH_HEADER = "X-Assistant-Health";
const ASSISTANT_HEALTH_ON = "on";

export function resolveHealthOptIn(c: Context): boolean {
  return c.req.header(ASSISTANT_HEALTH_HEADER) === ASSISTANT_HEALTH_ON;
}

export function resolveModelApiKey(c: Context): string {
  const key = c.req.header(GEMINI_KEY_HEADER)?.trim();
  if (!key) {
    // Names the setting rather than failing vaguely: the caller can act on
    // "you have not set a key yet" and cannot act on a 500.
    throw new BadRequestError("missing Gemini API key — set it in 設定 > AI 助手");
  }
  return key;
}
