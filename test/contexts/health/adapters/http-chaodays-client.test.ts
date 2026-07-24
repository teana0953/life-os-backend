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
});
