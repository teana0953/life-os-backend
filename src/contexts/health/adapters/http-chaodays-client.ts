import { ChaodaysAuthError, ChaodaysUpstreamError } from "../domain/chaodays-client";
import type {
  ChaodaysClient,
  ChaodaysDefecationRecord,
  ChaodaysDietMenu,
  ChaodaysDietRecord,
  ChaodaysMenstrualRecord,
  ChaodaysSession,
  ChaodaysWaterRecord,
  ChaodaysWeightRecord,
} from "../domain/chaodays-client";

/** Public, non-secret direct base URL for the chaodays API. */
const DIRECT_BASE_URL = "https://api.chaodays.app/api/v1";

/** A realistic browser UA so a WAF/bot rule doesn't reject the worker's default UA. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface RawWeightRecord {
  date: string;
  weight: number | null;
  body_fat_pct: number | null;
}

interface RawDietItem {
  name: string;
  staple: number | null;
  meat: number | null;
  fruit: number | null;
  veg: number | null;
}

interface RawDietRecord {
  date: string;
  record_type: "breakfast" | "lunch" | "dinner" | "extra";
  recorded_at: string;
  diet_record_items: RawDietItem[];
}

interface RawWaterRecord {
  date: string;
  water: number;
  recorded_at: string;
}

interface RawDefecationRecord {
  date: string;
  defecation: number;
  is_abnormality: boolean;
  note: string;
}

interface RawDietMenu {
  date: string;
  staple: number | null;
  meat: number | null;
  fruit: number | null;
  veg: number | null;
  water: number | null;
}

interface RawMenstrualRecord {
  id: number;
  started_date: string;
  ended_date: string | null;
}

/**
 * Page size for the menstrual list — the value chaodays' own frontend uses.
 * Not raised: if the upstream capped a larger value back to its own default,
 * any "a short page is the last page" rule would stop after page 1.
 */
const MENSTRUAL_PAGE_SIZE = 20;

/**
 * Hard per-batch page cap. Since the loop only ever succeeds by reading an
 * empty page, this admits 19 full pages — 380 periods in one 183-day batch, two
 * orders of magnitude above real data — so only a misbehaving upstream reaches
 * it. Kept small on purpose: the cap applies to each batch separately, so a
 * large one multiplied by the batches of a multi-year range would approach the
 * Workers subrequest budget, defeating the point of having a cap.
 */
const MENSTRUAL_MAX_PAGES = 20;

function authHeaders(session: ChaodaysSession): Record<string, string> {
  return { "access-token": session.accessToken, client: session.client, uid: session.uid };
}

/** Reads the session triple from response headers; falls back to `previous` for any header devise_token_auth didn't rotate. */
function sessionFromHeaders(headers: Headers, previous?: ChaodaysSession): ChaodaysSession {
  return {
    accessToken: headers.get("access-token") ?? previous?.accessToken ?? "",
    client: headers.get("client") ?? previous?.client ?? "",
    uid: headers.get("uid") ?? previous?.uid ?? "",
  };
}

/**
 * Driven adapter for the chaodays API (devise_token_auth). Never logs
 * request/response bodies or headers (they carry credentials/session tokens).
 * The `fetch` implementation is injected for testability.
 */
export class HttpChaodaysClient implements ChaodaysClient {
  private readonly baseUrl: string;
  private readonly relaySecret?: string;

  constructor(
    // Bind to `globalThis`: the Workers global `fetch` throws "Illegal invocation"
    // if invoked with a non-global `this` (which `this.fetchImpl(...)` below would
    // otherwise do). An injected fake fetch overrides this default and is unaffected.
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
    { baseUrl, relaySecret }: { baseUrl?: string; relaySecret?: string } = {},
  ) {
    this.baseUrl = baseUrl ?? DIRECT_BASE_URL;
    this.relaySecret = relaySecret;
  }

  async signIn(uid: string, password: string): Promise<ChaodaysSession> {
    const response = await this.request(`${this.baseUrl}/users/sign_in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { uid, password } }),
    });
    if (response.status === 401) throw new ChaodaysAuthError();
    if (!response.ok) throw new ChaodaysUpstreamError(`status_${response.status}`);
    return sessionFromHeaders(response.headers);
  }

  async fetchWeightRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysWeightRecord[] }> {
    const url = `${this.baseUrl}/users/weight_records?start_date=${from}&end_date=${to}`;
    const response = await this.request(url, { headers: authHeaders(session) });
    if (!response.ok) throw new ChaodaysUpstreamError(`status_${response.status}`);

    // A 200 with a non-JSON or unexpectedly-shaped body is still an upstream
    // failure (→ 502), not a lifeos-internal 500.
    let data: unknown;
    try {
      data = ((await response.json()) as { data?: unknown }).data;
    } catch {
      throw new ChaodaysUpstreamError("parse");
    }
    if (!Array.isArray(data)) throw new ChaodaysUpstreamError("parse");
    const records = (data as RawWeightRecord[]).map((raw) => ({
      date: raw.date,
      weight: raw.weight ?? null,
      bodyFatPct: raw.body_fat_pct ?? null,
    }));
    return { session: sessionFromHeaders(response.headers, session), records };
  }

  async fetchDietRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysDietRecord[] }> {
    const url = `${this.baseUrl}/users/diet_records?start_date=${from}&end_date=${to}`;
    const response = await this.request(url, { headers: authHeaders(session) });
    if (!response.ok) throw new ChaodaysUpstreamError(`status_${response.status}`);

    // A 200 with a non-JSON or unexpectedly-shaped body is still an upstream
    // failure (→ 502), not a lifeos-internal 500.
    let data: unknown;
    try {
      data = ((await response.json()) as { data?: unknown }).data;
    } catch {
      throw new ChaodaysUpstreamError("parse");
    }
    if (!Array.isArray(data)) throw new ChaodaysUpstreamError("parse");
    // Mapping a malformed record (e.g. a missing/non-array diet_record_items) is
    // still an upstream failure (→ 502), not a lifeos-internal 500.
    let records: ChaodaysDietRecord[];
    try {
      records = (data as RawDietRecord[]).map((raw) => ({
        date: raw.date,
        recordType: raw.record_type,
        recordedAt: raw.recorded_at,
        // oil/sugar are dropped — lifeos portions have no such axes.
        items: (raw.diet_record_items ?? []).map((item) => ({
          name: item.name ?? "",
          staple: item.staple ?? 0,
          meat: item.meat ?? 0,
          fruit: item.fruit ?? 0,
          veg: item.veg ?? 0,
        })),
      }));
    } catch {
      throw new ChaodaysUpstreamError("parse");
    }
    return { session: sessionFromHeaders(response.headers, session), records };
  }

  async fetchWaterRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysWaterRecord[] }> {
    const url = `${this.baseUrl}/users/water_records?start_date=${from}&end_date=${to}`;
    const response = await this.request(url, { headers: authHeaders(session) });
    if (!response.ok) throw new ChaodaysUpstreamError(`status_${response.status}`);

    // A 200 with a non-JSON or unexpectedly-shaped body is still an upstream
    // failure (→ 502), not a lifeos-internal 500.
    let data: unknown;
    try {
      data = ((await response.json()) as { data?: unknown }).data;
    } catch {
      throw new ChaodaysUpstreamError("parse");
    }
    if (!Array.isArray(data)) throw new ChaodaysUpstreamError("parse");
    // Mapping a malformed record is still an upstream failure (→ 502), not a 500.
    let records: ChaodaysWaterRecord[];
    try {
      records = (data as RawWaterRecord[]).map((raw) => ({
        date: raw.date,
        waterMl: raw.water ?? 0,
        recordedAt: raw.recorded_at,
      }));
    } catch {
      throw new ChaodaysUpstreamError("parse");
    }
    return { session: sessionFromHeaders(response.headers, session), records };
  }

  async fetchDefecationRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysDefecationRecord[] }> {
    const url = `${this.baseUrl}/users/defecation_records?start_date=${from}&end_date=${to}`;
    const response = await this.request(url, { headers: authHeaders(session) });
    if (!response.ok) throw new ChaodaysUpstreamError(`status_${response.status}`);

    // A 200 with a non-JSON or unexpectedly-shaped body is still an upstream
    // failure (→ 502), not a lifeos-internal 500.
    let data: unknown;
    try {
      data = ((await response.json()) as { data?: unknown }).data;
    } catch {
      throw new ChaodaysUpstreamError("parse");
    }
    if (!Array.isArray(data)) throw new ChaodaysUpstreamError("parse");
    // Mapping a malformed record is still an upstream failure (→ 502), not a 500.
    let records: ChaodaysDefecationRecord[];
    try {
      records = (data as RawDefecationRecord[]).map((raw) => ({
        date: raw.date,
        count: raw.defecation ?? 0,
        isAbnormality: raw.is_abnormality ?? false,
        note: raw.note ?? "",
      }));
    } catch {
      throw new ChaodaysUpstreamError("parse");
    }
    return { session: sessionFromHeaders(response.headers, session), records };
  }

  async fetchDietMenus(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; menus: ChaodaysDietMenu[] }> {
    const url = `${this.baseUrl}/users/diet_menus?start_date=${from}&end_date=${to}`;
    const response = await this.request(url, { headers: authHeaders(session) });
    if (!response.ok) throw new ChaodaysUpstreamError(`status_${response.status}`);

    // A 200 with a non-JSON or unexpectedly-shaped body is still an upstream
    // failure (→ 502), not a lifeos-internal 500.
    let data: unknown;
    try {
      data = ((await response.json()) as { data?: unknown }).data;
    } catch {
      throw new ChaodaysUpstreamError("parse");
    }
    if (!Array.isArray(data)) throw new ChaodaysUpstreamError("parse");
    // Mapping a malformed menu is still an upstream failure (→ 502), not a 500.
    let menus: ChaodaysDietMenu[];
    try {
      menus = (data as RawDietMenu[]).map((raw) => ({
        date: raw.date,
        // oil/sugar/content/sum_* are dropped — lifeos targets have no such axes.
        staple: raw.staple ?? 0,
        meat: raw.meat ?? 0,
        fruit: raw.fruit ?? 0,
        veg: raw.veg ?? 0,
        waterTargetMl: raw.water ?? 0,
      }));
    } catch {
      throw new ChaodaysUpstreamError("parse");
    }
    return { session: sessionFromHeaders(response.headers, session), menus };
  }

  /**
   * Unlike the other collections this endpoint paginates, so the range is read
   * page by page here and handed back whole.
   *
   * The stop condition is "a page came back with no records" — deliberately not
   * the response envelope's `pagination` block (we would be guessing its key
   * name, and guessing wrong stops after page 1: a silent under-fetch) and not
   * "fewer than `per_page` records" (that bets the upstream never post-filters a
   * page, and losing the bet is the same silent under-fetch).
   */
  async fetchMenstruals(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysMenstrualRecord[] }> {
    let currentSession = session;
    const records: ChaodaysMenstrualRecord[] = [];

    for (let page = 1; page <= MENSTRUAL_MAX_PAGES; page++) {
      const url = `${this.baseUrl}/users/menstruals?start_date=${from}&end_date=${to}&page=${page}&per_page=${MENSTRUAL_PAGE_SIZE}`;
      const response = await this.request(url, { headers: authHeaders(currentSession) });
      if (!response.ok) throw new ChaodaysUpstreamError(`status_${response.status}`);

      // A 200 with a non-JSON or unexpectedly-shaped body is still an upstream
      // failure (→ 502), not a lifeos-internal 500.
      let data: unknown;
      try {
        data = ((await response.json()) as { data?: unknown }).data;
      } catch {
        throw new ChaodaysUpstreamError("parse");
      }
      if (!Array.isArray(data)) throw new ChaodaysUpstreamError("parse");

      currentSession = sessionFromHeaders(response.headers, currentSession);
      if (data.length === 0) return { session: currentSession, records };

      // Malformed dates are rejected here, before anything is written: a period
      // ending before it starts would otherwise reach `addPeriod` and escape as
      // an unmapped InvalidPeriodError (→ 500 rather than 502).
      for (const raw of data as RawMenstrualRecord[]) {
        // Without an id the import's de-duplication would treat every record on
        // the page as the same one and keep only the first — a silent loss.
        if (raw?.id === undefined || raw.id === null) throw new ChaodaysUpstreamError("parse");
        const startDate = raw.started_date;
        if (!startDate) throw new ChaodaysUpstreamError("parse");
        // An empty ended_date means "not ended"; left as-is it would break every
        // date comparison downstream.
        const endDate = raw.ended_date ? raw.ended_date : null;
        if (endDate !== null && endDate < startDate) throw new ChaodaysUpstreamError("parse");
        // days/content are dropped — lifeos has no such fields.
        records.push({ id: raw.id, startDate, endDate });
      }
    }

    throw new ChaodaysUpstreamError("pagination");
  }

  /** Wraps `fetch`, turning a network failure into `ChaodaysUpstreamError`. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        headers: {
          // A realistic UA: some WAF/bot rules reject a missing/worker default UA.
          "User-Agent": USER_AGENT,
          ...(init.headers as Record<string, string> | undefined),
          // Only added when a relay is configured; never logged (same rule as
          // the credential/session headers above).
          ...(this.relaySecret ? { "X-Relay-Secret": this.relaySecret } : {}),
        },
      });
    } catch (e) {
      // Include the connection-level failure message (no credentials — it's a
      // transport error like "Network connection lost") to tell apart a dropped
      // connection, DNS, TLS, etc.
      const detail = e instanceof Error ? e.message : String(e);
      throw new ChaodaysUpstreamError(`network: ${detail}`.slice(0, 120));
    }
  }
}
