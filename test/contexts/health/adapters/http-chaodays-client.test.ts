import { describe, expect, it } from "vitest";
import { HttpChaodaysClient } from "../../../../src/contexts/health/adapters/http-chaodays-client";
import { ChaodaysAuthError, ChaodaysUpstreamError } from "../../../../src/contexts/health/domain/chaodays-client";
import type { ChaodaysSession } from "../../../../src/contexts/health/domain/chaodays-client";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function fakeFetch(response: Response, calls: FetchCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  }) as typeof fetch;
}

/**
 * A fake fetch that builds a fresh Response per call (a `Response` body can only
 * be read once, so a paginating client needs a new one each time). `callIndex`
 * is 0-based.
 */
function fakeFetchPerCall(makeResponse: (callIndex: number) => Response, calls: FetchCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = makeResponse(calls.length);
    calls.push({ url: String(input), init });
    return response;
  }) as typeof fetch;
}

describe("HttpChaodaysClient", () => {
  describe("signIn", () => {
    it("posts uid/password and reads the session triple from response headers", async () => {
      const calls: FetchCall[] = [];
      const response = new Response("{}", {
        status: 200,
        headers: { "access-token": "token-1", client: "client-1", uid: "uid-1" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, calls));

      const session = await client.signIn("chaodays-uid", "secret-pw");

      expect(session).toEqual({ accessToken: "token-1", client: "client-1", uid: "uid-1" });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://api.chaodays.app/api/v1/users/sign_in");
      expect(calls[0].init?.method).toBe("POST");
      expect(JSON.parse(calls[0].init?.body as string)).toEqual({
        user: { uid: "chaodays-uid", password: "secret-pw" },
      });
    });

    it("throws ChaodaysAuthError on a 401 response", async () => {
      const response = new Response("{}", { status: 401 });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.signIn("chaodays-uid", "wrong-pw")).rejects.toThrow(ChaodaysAuthError);
    });

    it("throws ChaodaysUpstreamError on a non-401 non-200 response", async () => {
      const response = new Response("{}", { status: 500 });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.signIn("chaodays-uid", "pw")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError when the network request fails", async () => {
      const throwingFetch = (async () => {
        throw new Error("network down");
      }) as typeof fetch;
      const client = new HttpChaodaysClient(throwingFetch);

      await expect(client.signIn("chaodays-uid", "pw")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("targets the direct chaodays URL and carries no X-Relay-Secret header by default", async () => {
      const calls: FetchCall[] = [];
      const response = new Response("{}", {
        status: 200,
        headers: { "access-token": "token-1", client: "client-1", uid: "uid-1" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, calls));

      await client.signIn("chaodays-uid", "secret-pw");

      expect(calls[0].url).toBe("https://api.chaodays.app/api/v1/users/sign_in");
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.has("X-Relay-Secret")).toBe(false);
    });
  });

  describe("relay configuration", () => {
    const session: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

    it("targets the relay base URL and carries the X-Relay-Secret header on signIn and data fetches", async () => {
      const calls: FetchCall[] = [];
      const signInResponse = new Response("{}", {
        status: 200,
        headers: { "access-token": "token-1", client: "client-1", uid: "uid-1" },
      });
      const client = new HttpChaodaysClient(fakeFetch(signInResponse, calls), {
        baseUrl: "https://1-2-3-4.nip.io/api/v1",
        relaySecret: "s3cret",
      });

      await client.signIn("chaodays-uid", "secret-pw");

      expect(calls[0].url).toBe("https://1-2-3-4.nip.io/api/v1/users/sign_in");
      const signInHeaders = new Headers(calls[0].init?.headers);
      expect(signInHeaders.get("X-Relay-Secret")).toBe("s3cret");

      const weightResponse = new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "access-token": "token-2", client: "client-1", uid: "uid-1" },
      });
      const weightClient = new HttpChaodaysClient(fakeFetch(weightResponse, calls), {
        baseUrl: "https://1-2-3-4.nip.io/api/v1",
        relaySecret: "s3cret",
      });

      await weightClient.fetchWeightRecords(session, "2026-07-01", "2026-07-02");

      expect(calls[1].url).toBe(
        "https://1-2-3-4.nip.io/api/v1/users/weight_records?start_date=2026-07-01&end_date=2026-07-02",
      );
      const weightHeaders = new Headers(calls[1].init?.headers);
      expect(weightHeaders.get("X-Relay-Secret")).toBe("s3cret");
    });
  });

  describe("fetchWeightRecords", () => {
    const session: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

    it("sends the three headers, parses the data envelope, and returns the rotated session", async () => {
      const calls: FetchCall[] = [];
      const body = JSON.stringify({
        data: [
          { id: 1, date: "2026-07-01", weight: 65.5, body_fat_pct: 22.1 },
          { id: 2, date: "2026-07-02", weight: 65.2, body_fat_pct: null },
        ],
      });
      const response = new Response(body, {
        status: 200,
        headers: { "access-token": "token-2", client: "client-1", uid: "uid-1" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, calls));

      const result = await client.fetchWeightRecords(session, "2026-07-01", "2026-07-02");

      expect(result.session).toEqual({ accessToken: "token-2", client: "client-1", uid: "uid-1" });
      expect(result.records).toEqual([
        { date: "2026-07-01", weight: 65.5, bodyFatPct: 22.1 },
        { date: "2026-07-02", weight: 65.2, bodyFatPct: null },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        "https://api.chaodays.app/api/v1/users/weight_records?start_date=2026-07-01&end_date=2026-07-02",
      );
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("access-token")).toBe("token-1");
      expect(headers.get("client")).toBe("client-1");
      expect(headers.get("uid")).toBe("uid-1");
    });

    it("throws ChaodaysUpstreamError on a non-200 response", async () => {
      const response = new Response("{}", { status: 500 });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchWeightRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-array data body (→ 502, not 500)", async () => {
      const response = new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchWeightRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-JSON body", async () => {
      const response = new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchWeightRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });
  });

  describe("fetchDietRecords", () => {
    const session: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

    it("sends the three headers, parses the data envelope dropping oil/sugar, and returns the rotated session", async () => {
      const calls: FetchCall[] = [];
      const body = JSON.stringify({
        data: [
          {
            date: "2026-07-01",
            record_type: "lunch",
            recorded_at: "2026-07-01 12:30",
            staple: 2,
            meat: 1,
            fruit: 0,
            veg: 1,
            oil: 1,
            sugar: 0,
            diet_record_items: [
              { name: "白飯", staple: 2, meat: 0, fruit: 0, veg: 0, oil: 0, sugar: 0 },
              { name: "前血糖：93", staple: 0, meat: 0, fruit: 0, veg: 0, oil: 0, sugar: 0 },
            ],
          },
        ],
      });
      const response = new Response(body, {
        status: 200,
        headers: { "access-token": "token-2", client: "client-1", uid: "uid-1" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, calls));

      const result = await client.fetchDietRecords(session, "2026-07-01", "2026-07-02");

      expect(result.session).toEqual({ accessToken: "token-2", client: "client-1", uid: "uid-1" });
      expect(result.records).toEqual([
        {
          date: "2026-07-01",
          recordType: "lunch",
          recordedAt: "2026-07-01 12:30",
          items: [
            { name: "白飯", staple: 2, meat: 0, fruit: 0, veg: 0 },
            { name: "前血糖：93", staple: 0, meat: 0, fruit: 0, veg: 0 },
          ],
        },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        "https://api.chaodays.app/api/v1/users/diet_records?start_date=2026-07-01&end_date=2026-07-02",
      );
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("access-token")).toBe("token-1");
      expect(headers.get("client")).toBe("client-1");
      expect(headers.get("uid")).toBe("uid-1");
    });

    it("throws ChaodaysUpstreamError on a non-200 response", async () => {
      const response = new Response("{}", { status: 500 });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDietRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-array data body", async () => {
      const response = new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDietRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 whose record has a non-array diet_record_items (→ 502, not 500)", async () => {
      const response = new Response(
        JSON.stringify({ data: [{ date: "2026-07-01", record_type: "lunch", recorded_at: "2026-07-01 12:30", diet_record_items: "oops" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDietRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-JSON body", async () => {
      const response = new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDietRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });
  });

  describe("fetchWaterRecords", () => {
    const session: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

    it("sends the three headers, parses the data envelope, and returns the rotated session", async () => {
      const calls: FetchCall[] = [];
      const body = JSON.stringify({
        data: [
          { date: "2026-07-01", water: 250, recorded_at: "2026-07-01 09:00" },
          { date: "2026-07-01", water: 500, recorded_at: "2026-07-01 14:00" },
        ],
      });
      const response = new Response(body, {
        status: 200,
        headers: { "access-token": "token-2", client: "client-1", uid: "uid-1" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, calls));

      const result = await client.fetchWaterRecords(session, "2026-07-01", "2026-07-02");

      expect(result.session).toEqual({ accessToken: "token-2", client: "client-1", uid: "uid-1" });
      expect(result.records).toEqual([
        { date: "2026-07-01", waterMl: 250, recordedAt: "2026-07-01 09:00" },
        { date: "2026-07-01", waterMl: 500, recordedAt: "2026-07-01 14:00" },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        "https://api.chaodays.app/api/v1/users/water_records?start_date=2026-07-01&end_date=2026-07-02",
      );
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("access-token")).toBe("token-1");
      expect(headers.get("client")).toBe("client-1");
      expect(headers.get("uid")).toBe("uid-1");
    });

    it("throws ChaodaysUpstreamError on a non-200 response", async () => {
      const response = new Response("{}", { status: 500 });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchWaterRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-array data body (→ 502, not 500)", async () => {
      const response = new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchWaterRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-JSON body", async () => {
      const response = new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchWaterRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 whose data array has a null record (→ 502, not 500)", async () => {
      const response = new Response(JSON.stringify({ data: [null] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchWaterRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });
  });

  describe("fetchDietMenus", () => {
    const session: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

    it("sends the three headers, parses the data envelope dropping oil/sugar/content/sum_*, and returns the rotated session", async () => {
      const calls: FetchCall[] = [];
      const body = JSON.stringify({
        data: [
          {
            date: "2026-07-01",
            staple: 12,
            meat: 6,
            fruit: 2,
            veg: 3,
            oil: 4,
            sugar: 1,
            water: 2000,
            content: "notes",
            sum_staple: 10,
          },
        ],
      });
      const response = new Response(body, {
        status: 200,
        headers: { "access-token": "token-2", client: "client-1", uid: "uid-1" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, calls));

      const result = await client.fetchDietMenus(session, "2026-07-01", "2026-07-02");

      expect(result.session).toEqual({ accessToken: "token-2", client: "client-1", uid: "uid-1" });
      expect(result.menus).toEqual([
        { date: "2026-07-01", staple: 12, meat: 6, fruit: 2, veg: 3, waterTargetMl: 2000 },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        "https://api.chaodays.app/api/v1/users/diet_menus?start_date=2026-07-01&end_date=2026-07-02",
      );
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("access-token")).toBe("token-1");
      expect(headers.get("client")).toBe("client-1");
      expect(headers.get("uid")).toBe("uid-1");
    });

    it("defaults null portions and a null water target to 0", async () => {
      const body = JSON.stringify({
        data: [{ date: "2026-07-01", staple: null, meat: null, fruit: null, veg: null, water: null }],
      });
      const response = new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      const result = await client.fetchDietMenus(session, "2026-07-01", "2026-07-02");

      expect(result.menus).toEqual([{ date: "2026-07-01", staple: 0, meat: 0, fruit: 0, veg: 0, waterTargetMl: 0 }]);
    });

    it("throws ChaodaysUpstreamError on a non-200 response", async () => {
      const response = new Response("{}", { status: 500 });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDietMenus(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-array data body (→ 502, not 500)", async () => {
      const response = new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDietMenus(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-JSON body", async () => {
      const response = new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDietMenus(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 whose data array has a null record (→ 502, not 500)", async () => {
      const response = new Response(JSON.stringify({ data: [null] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDietMenus(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });
  });

  describe("fetchDefecationRecords", () => {
    const session: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

    it("sends the three headers, parses the data envelope, and returns the rotated session", async () => {
      const calls: FetchCall[] = [];
      const body = JSON.stringify({
        data: [
          { date: "2026-07-01", defecation: 1, is_abnormality: false, note: "正常" },
          { date: "2026-07-01", defecation: 1, is_abnormality: true, note: "" },
        ],
      });
      const response = new Response(body, {
        status: 200,
        headers: { "access-token": "token-2", client: "client-1", uid: "uid-1" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, calls));

      const result = await client.fetchDefecationRecords(session, "2026-07-01", "2026-07-02");

      expect(result.session).toEqual({ accessToken: "token-2", client: "client-1", uid: "uid-1" });
      expect(result.records).toEqual([
        { date: "2026-07-01", count: 1, isAbnormality: false, note: "正常" },
        { date: "2026-07-01", count: 1, isAbnormality: true, note: "" },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        "https://api.chaodays.app/api/v1/users/defecation_records?start_date=2026-07-01&end_date=2026-07-02",
      );
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("access-token")).toBe("token-1");
      expect(headers.get("client")).toBe("client-1");
      expect(headers.get("uid")).toBe("uid-1");
    });

    it("throws ChaodaysUpstreamError on a non-200 response", async () => {
      const response = new Response("{}", { status: 500 });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDefecationRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-array data body (→ 502, not 500)", async () => {
      const response = new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDefecationRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-JSON body", async () => {
      const response = new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDefecationRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 whose data array has a null record (→ 502, not 500)", async () => {
      const response = new Response(JSON.stringify({ data: [null] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchDefecationRecords(session, "2026-07-01", "2026-07-02")).rejects.toThrow(ChaodaysUpstreamError);
    });
  });

  describe("fetchMenstruals", () => {
    const session: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

    /**
     * One page of the menstrual list. The envelope deliberately carries NO
     * `pagination` key: the stop condition must not read it (guessing its key
     * name fails by stopping after page 1 — exactly the bug this endpoint's
     * paging exists to avoid, and a fake that supplied it would hide).
     * Each page rotates the session so "page N+1 uses page N's session" can fail.
     */
    function page(records: unknown[], accessToken: string): Response {
      return new Response(JSON.stringify({ data: records }), {
        status: 200,
        headers: { "access-token": accessToken, client: "client-1", uid: "uid-1" },
      });
    }

    function rawPeriod(id: number, startedDate: string, endedDate: string | null): unknown {
      return { id, started_date: startedDate, ended_date: endedDate, days: 5, content: "note" };
    }

    it("pages until a page comes back empty, concatenating in order and returning the last rotated session", async () => {
      const calls: FetchCall[] = [];
      const pages = [
        page([rawPeriod(1, "2026-01-05", "2026-01-09"), rawPeriod(2, "2026-02-03", "2026-02-07")], "token-2"),
        page([rawPeriod(3, "2026-03-01", "2026-03-05")], "token-3"),
        page([], "token-4"),
      ];
      const client = new HttpChaodaysClient(fakeFetchPerCall((i) => pages[i], calls));

      const result = await client.fetchMenstruals(session, "2026-01-01", "2026-03-31");

      expect(result.records).toEqual([
        { id: 1, startDate: "2026-01-05", endDate: "2026-01-09" },
        { id: 2, startDate: "2026-02-03", endDate: "2026-02-07" },
        { id: 3, startDate: "2026-03-01", endDate: "2026-03-05" },
      ]);
      expect(result.session).toEqual({ accessToken: "token-4", client: "client-1", uid: "uid-1" });
      expect(calls).toHaveLength(3);
      expect(calls[0].url).toBe(
        "https://api.chaodays.app/api/v1/users/menstruals?start_date=2026-01-01&end_date=2026-03-31&page=1&per_page=20",
      );
      expect(calls[1].url).toBe(
        "https://api.chaodays.app/api/v1/users/menstruals?start_date=2026-01-01&end_date=2026-03-31&page=2&per_page=20",
      );
      expect(calls[2].url).toBe(
        "https://api.chaodays.app/api/v1/users/menstruals?start_date=2026-01-01&end_date=2026-03-31&page=3&per_page=20",
      );
      const headers = new Headers(calls[0].init?.headers);
      expect(headers.get("access-token")).toBe("token-1");
      expect(headers.get("client")).toBe("client-1");
      expect(headers.get("uid")).toBe("uid-1");
    });

    it("keeps paging after a page shorter than per_page (a short page is not the last page)", async () => {
      const calls: FetchCall[] = [];
      const pages = [
        page([rawPeriod(1, "2026-01-05", "2026-01-09")], "token-2"),
        page([rawPeriod(2, "2026-02-03", "2026-02-07")], "token-3"),
        page([], "token-4"),
      ];
      const client = new HttpChaodaysClient(fakeFetchPerCall((i) => pages[i], calls));

      const result = await client.fetchMenstruals(session, "2026-01-01", "2026-03-31");

      expect(result.records.map((r) => r.id)).toEqual([1, 2]);
      expect(calls).toHaveLength(3);
    });

    it("presents the session the previous page returned on each following request", async () => {
      const calls: FetchCall[] = [];
      const pages = [
        page([rawPeriod(1, "2026-01-05", "2026-01-09")], "token-2"),
        page([rawPeriod(2, "2026-02-03", "2026-02-07")], "token-3"),
        page([], "token-4"),
      ];
      const client = new HttpChaodaysClient(fakeFetchPerCall((i) => pages[i], calls));

      await client.fetchMenstruals(session, "2026-01-01", "2026-03-31");

      expect(new Headers(calls[0].init?.headers).get("access-token")).toBe("token-1");
      expect(new Headers(calls[1].init?.headers).get("access-token")).toBe("token-2");
      expect(new Headers(calls[2].init?.headers).get("access-token")).toBe("token-3");
    });

    it("fails with 'pagination' instead of looping when the upstream never returns an empty page", async () => {
      const calls: FetchCall[] = [];
      const fullPage = (i: number) =>
        page(
          Array.from({ length: 20 }, (_, n) => rawPeriod(i * 20 + n, "2026-01-05", "2026-01-09")),
          `token-${i + 2}`,
        );
      const client = new HttpChaodaysClient(fakeFetchPerCall(fullPage, calls));

      const error = await client.fetchMenstruals(session, "2026-01-01", "2026-03-31").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ChaodaysUpstreamError);
      expect((error as ChaodaysUpstreamError).reason).toBe("pagination");
      expect(calls).toHaveLength(20);
    });

    it("maps an empty ended_date to null", async () => {
      const pages = [page([rawPeriod(1, "2026-01-05", "")], "token-2"), page([], "token-3")];
      const client = new HttpChaodaysClient(fakeFetchPerCall((i) => pages[i], []));

      const result = await client.fetchMenstruals(session, "2026-01-01", "2026-03-31");

      expect(result.records).toEqual([{ id: 1, startDate: "2026-01-05", endDate: null }]);
    });

    it("maps a null ended_date to null", async () => {
      const pages = [page([rawPeriod(1, "2026-01-05", null)], "token-2"), page([], "token-3")];
      const client = new HttpChaodaysClient(fakeFetchPerCall((i) => pages[i], []));

      const result = await client.fetchMenstruals(session, "2026-01-01", "2026-03-31");

      expect(result.records).toEqual([{ id: 1, startDate: "2026-01-05", endDate: null }]);
    });

    it("throws 'parse' when ended_date is earlier than started_date (→ 502, never a 500 from addPeriod)", async () => {
      const pages = [page([rawPeriod(1, "2026-01-09", "2026-01-05")], "token-2")];
      const client = new HttpChaodaysClient(fakeFetchPerCall((i) => pages[i], []));

      const error = await client.fetchMenstruals(session, "2026-01-01", "2026-03-31").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ChaodaysUpstreamError);
      expect((error as ChaodaysUpstreamError).reason).toBe("parse");
    });

    it.each([
      ["missing", undefined],
      ["empty", ""],
    ])("throws 'parse' when started_date is %s", async (_desc, startedDate) => {
      const pages = [
        page([{ id: 1, started_date: startedDate, ended_date: "2026-01-09" }], "token-2"),
      ];
      const client = new HttpChaodaysClient(fakeFetchPerCall((i) => pages[i], []));

      const error = await client.fetchMenstruals(session, "2026-01-01", "2026-03-31").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ChaodaysUpstreamError);
      expect((error as ChaodaysUpstreamError).reason).toBe("parse");
    });

    it("throws 'parse' when a record has no id (de-duplication would silently collapse the page)", async () => {
      const pages = [
        page(
          [
            { started_date: "2026-01-05", ended_date: "2026-01-09" },
            { started_date: "2026-02-05", ended_date: "2026-02-09" },
          ],
          "token-2",
        ),
      ];
      const client = new HttpChaodaysClient(fakeFetchPerCall((i) => pages[i], []));

      const error = await client.fetchMenstruals(session, "2026-01-01", "2026-03-31").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ChaodaysUpstreamError);
      expect((error as ChaodaysUpstreamError).reason).toBe("parse");
    });

    it("targets the relay base URL and carries the X-Relay-Secret header on every page", async () => {
      const calls: FetchCall[] = [];
      const pages = [page([rawPeriod(1, "2026-01-05", "2026-01-09")], "token-2"), page([], "token-3")];
      const client = new HttpChaodaysClient(fakeFetchPerCall((i) => pages[i], calls), {
        baseUrl: "https://1-2-3-4.nip.io/api/v1",
        relaySecret: "s3cret",
      });

      await client.fetchMenstruals(session, "2026-01-01", "2026-03-31");

      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call.url.startsWith("https://1-2-3-4.nip.io/api/v1/users/menstruals?")).toBe(true);
        expect(new Headers(call.init?.headers).get("X-Relay-Secret")).toBe("s3cret");
      }
    });

    it("throws ChaodaysUpstreamError on a non-200 response", async () => {
      const response = new Response("{}", { status: 500 });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      const error = await client.fetchMenstruals(session, "2026-01-01", "2026-03-31").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ChaodaysUpstreamError);
      expect((error as ChaodaysUpstreamError).reason).toBe("status_500");
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-array data body (→ 502, not 500)", async () => {
      const response = new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchMenstruals(session, "2026-01-01", "2026-03-31")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 with a non-JSON body", async () => {
      const response = new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
      const client = new HttpChaodaysClient(fakeFetch(response, []));

      await expect(client.fetchMenstruals(session, "2026-01-01", "2026-03-31")).rejects.toThrow(ChaodaysUpstreamError);
    });

    it("throws ChaodaysUpstreamError on a 200 whose data array has a null record (→ 502, not 500)", async () => {
      const pages = [page([null], "token-2")];
      const client = new HttpChaodaysClient(fakeFetchPerCall((i) => pages[i], []));

      await expect(client.fetchMenstruals(session, "2026-01-01", "2026-03-31")).rejects.toThrow(ChaodaysUpstreamError);
    });
  });
});
