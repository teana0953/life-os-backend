import { ChaodaysAuthError, ChaodaysUpstreamError } from "../domain/chaodays-client";
import type { ChaodaysClient, ChaodaysDietRecord, ChaodaysSession, ChaodaysWeightRecord } from "../domain/chaodays-client";

/** Public, non-secret base URL for the chaodays API. */
const BASE_URL = "https://api.chaodays.app/api/v1";

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
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async signIn(uid: string, password: string): Promise<ChaodaysSession> {
    const response = await this.request(`${BASE_URL}/users/sign_in`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { uid, password } }),
    });
    if (response.status === 401) throw new ChaodaysAuthError();
    if (!response.ok) throw new ChaodaysUpstreamError();
    return sessionFromHeaders(response.headers);
  }

  async fetchWeightRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysWeightRecord[] }> {
    const url = `${BASE_URL}/users/weight_records?start_date=${from}&end_date=${to}`;
    const response = await this.request(url, { headers: authHeaders(session) });
    if (!response.ok) throw new ChaodaysUpstreamError();

    // A 200 with a non-JSON or unexpectedly-shaped body is still an upstream
    // failure (→ 502), not a lifeos-internal 500.
    let data: unknown;
    try {
      data = ((await response.json()) as { data?: unknown }).data;
    } catch {
      throw new ChaodaysUpstreamError();
    }
    if (!Array.isArray(data)) throw new ChaodaysUpstreamError();
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
    const url = `${BASE_URL}/users/diet_records?start_date=${from}&end_date=${to}`;
    const response = await this.request(url, { headers: authHeaders(session) });
    if (!response.ok) throw new ChaodaysUpstreamError();

    // A 200 with a non-JSON or unexpectedly-shaped body is still an upstream
    // failure (→ 502), not a lifeos-internal 500.
    let data: unknown;
    try {
      data = ((await response.json()) as { data?: unknown }).data;
    } catch {
      throw new ChaodaysUpstreamError();
    }
    if (!Array.isArray(data)) throw new ChaodaysUpstreamError();
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
      throw new ChaodaysUpstreamError();
    }
    return { session: sessionFromHeaders(response.headers, session), records };
  }

  /** Wraps `fetch`, turning a network failure into `ChaodaysUpstreamError`. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch {
      throw new ChaodaysUpstreamError();
    }
  }
}
