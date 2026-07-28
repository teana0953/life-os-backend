import { beforeEach, describe, expect, it } from "vitest";
import { InvalidPeriodError } from "../../../../src/contexts/health/application/add-period";
import { importChaodaysMenstrual } from "../../../../src/contexts/health/application/import-chaodays-menstrual";
import { ChaodaysAuthError, ChaodaysUpstreamError } from "../../../../src/contexts/health/domain/chaodays-client";
import type {
  ChaodaysClient,
  ChaodaysMenstrualRecord,
  ChaodaysSession,
} from "../../../../src/contexts/health/domain/chaodays-client";
import type { MenstrualPeriod } from "../../../../src/contexts/health/domain/menstrual-period";
import type {
  AddPeriodInput,
  MenstrualRepository,
  UpdatePeriodPatch,
} from "../../../../src/contexts/health/domain/menstrual-repository";

class InMemoryMenstrualRepository implements MenstrualRepository {
  private periods: MenstrualPeriod[] = [];
  private nextId = 1;
  addCallCount = 0;

  async add(input: AddPeriodInput): Promise<MenstrualPeriod> {
    this.addCallCount++;
    const period: MenstrualPeriod = { id: `period-${this.nextId++}`, ...input };
    this.periods.push(period);
    return period;
  }

  async listByUser(userId: string): Promise<MenstrualPeriod[]> {
    return this.periods
      .filter((p) => p.userId === userId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  async update(_userId: string, _id: string, _patch: UpdatePeriodPatch): Promise<MenstrualPeriod | null> {
    throw new Error("not used in this test");
  }

  async delete(_userId: string, _id: string): Promise<boolean> {
    throw new Error("not used in this test");
  }
}

const SESSION: ChaodaysSession = { accessToken: "token-1", client: "client-1", uid: "uid-1" };

class FakeChaodaysClient implements ChaodaysClient {
  signInError: Error | null = null;
  records: ChaodaysMenstrualRecord[] = [];
  signInArgs: { uid: string; password: string } | null = null;
  signInCallCount = 0;
  fetchCalls: { from: string; to: string }[] = [];
  /** When set, the fetch with this 1-based call number throws instead of returning. */
  failOnFetchCall: number | null = null;
  /**
   * How the upstream is imagined to filter a batch: by the period's start date
   * (a period lands in exactly one batch) or by the period overlapping the
   * range (a period spanning a batch boundary comes back in both). We do not
   * know which chaodays does — the import has to be right either way.
   */
  filterByOverlap = false;

  async signIn(uid: string, password: string): Promise<ChaodaysSession> {
    this.signInArgs = { uid, password };
    this.signInCallCount++;
    if (this.signInError) throw this.signInError;
    return SESSION;
  }

  fetchWeightRecords(): never {
    throw new Error("not used in this test");
  }

  fetchDietRecords(): never {
    throw new Error("not used in this test");
  }

  fetchWaterRecords(): never {
    throw new Error("not used in this test");
  }

  fetchDefecationRecords(): never {
    throw new Error("not used in this test");
  }

  fetchDietMenus(): never {
    throw new Error("not used in this test");
  }

  async fetchMenstruals(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysMenstrualRecord[] }> {
    this.fetchCalls.push({ from, to });
    if (this.fetchCalls.length === this.failOnFetchCall) throw new ChaodaysUpstreamError("status_502");
    const records = this.records.filter((r) =>
      this.filterByOverlap
        ? r.startDate <= to && (r.endDate ?? "9999-12-31") >= from
        : r.startDate >= from && r.startDate <= to,
    );
    return { session, records };
  }
}

function record(id: number, startDate: string, endDate: string | null): ChaodaysMenstrualRecord {
  return { id, startDate, endDate };
}

let menstrualRepository: InMemoryMenstrualRepository;
let chaodaysClient: FakeChaodaysClient;

beforeEach(() => {
  menstrualRepository = new InMemoryMenstrualRepository();
  chaodaysClient = new FakeChaodaysClient();
});

function runImport(from = "2026-01-01", to = "2026-03-31") {
  return importChaodaysMenstrual(menstrualRepository, chaodaysClient, {
    userId: "user-1",
    uid: "chaodays-uid",
    password: "chaodays-pw",
    from,
    to,
  });
}

async function storedDates(): Promise<{ startDate: string; endDate: string | null }[]> {
  return (await menstrualRepository.listByUser("user-1")).map((p) => ({
    startDate: p.startDate,
    endDate: p.endDate,
  }));
}

describe("importChaodaysMenstrual", () => {
  it("imports every source period when lifeos has none", async () => {
    chaodaysClient.records = [record(1, "2026-01-05", "2026-01-09"), record(2, "2026-02-03", "2026-02-07")];

    const summary = await runImport();

    expect(summary).toEqual({ imported: 2, skipped: 0, from: "2026-01-01", to: "2026-03-31" });
    expect(chaodaysClient.signInArgs).toEqual({ uid: "chaodays-uid", password: "chaodays-pw" });
    expect(chaodaysClient.fetchCalls).toEqual([{ from: "2026-01-01", to: "2026-03-31" }]);
    expect(await storedDates()).toEqual([
      { startDate: "2026-01-05", endDate: "2026-01-09" },
      { startDate: "2026-02-03", endDate: "2026-02-07" },
    ]);
  });

  it("skips a source period identical to one lifeos already has", async () => {
    await menstrualRepository.add({ userId: "user-1", startDate: "2026-01-05", endDate: "2026-01-09" });
    chaodaysClient.records = [record(1, "2026-01-05", "2026-01-09")];

    const summary = await runImport();

    expect(summary).toEqual({ imported: 0, skipped: 1, from: "2026-01-01", to: "2026-03-31" });
    expect(await storedDates()).toEqual([{ startDate: "2026-01-05", endDate: "2026-01-09" }]);
  });

  it("skips a source period offset by a day from an existing one", async () => {
    await menstrualRepository.add({ userId: "user-1", startDate: "2026-01-05", endDate: "2026-01-09" });
    chaodaysClient.records = [record(1, "2026-01-06", "2026-01-10")];

    const summary = await runImport();

    expect(summary).toEqual({ imported: 0, skipped: 1, from: "2026-01-01", to: "2026-03-31" });
    expect(await storedDates()).toEqual([{ startDate: "2026-01-05", endDate: "2026-01-09" }]);
  });

  it("imports a period immediately adjacent to an existing one", async () => {
    await menstrualRepository.add({ userId: "user-1", startDate: "2026-01-01", endDate: "2026-01-05" });
    chaodaysClient.records = [record(1, "2026-01-06", "2026-01-10")];

    const summary = await runImport();

    expect(summary).toEqual({ imported: 1, skipped: 0, from: "2026-01-01", to: "2026-03-31" });
    expect(await storedDates()).toEqual([
      { startDate: "2026-01-01", endDate: "2026-01-05" },
      { startDate: "2026-01-06", endDate: "2026-01-10" },
    ]);
  });

  it("skips every source period after an existing open-ended lifeos period", async () => {
    await menstrualRepository.add({ userId: "user-1", startDate: "2026-01-05", endDate: null });
    chaodaysClient.records = [record(1, "2026-02-03", "2026-02-07"), record(2, "2026-03-01", "2026-03-05")];

    const summary = await runImport();

    expect(summary).toEqual({ imported: 0, skipped: 2, from: "2026-01-01", to: "2026-03-31" });
    expect(menstrualRepository.addCallCount).toBe(1); // the setup one only
  });

  it("skips a source period starting before an existing open-ended one but overlapping it", async () => {
    await menstrualRepository.add({ userId: "user-1", startDate: "2026-01-10", endDate: null });
    chaodaysClient.records = [record(1, "2026-01-09", "2026-01-14")];

    const summary = await runImport();

    expect(summary).toEqual({ imported: 0, skipped: 1, from: "2026-01-01", to: "2026-03-31" });
    expect(await storedDates()).toEqual([{ startDate: "2026-01-10", endDate: null }]);
  });

  it("does not import a source period chaodays has not yet closed, counting it as skipped", async () => {
    chaodaysClient.records = [record(1, "2026-01-05", "2026-01-09"), record(2, "2026-03-20", null)];

    const summary = await runImport();

    expect(summary).toEqual({ imported: 1, skipped: 1, from: "2026-01-01", to: "2026-03-31" });
    expect(await storedDates()).toEqual([{ startDate: "2026-01-05", endDate: "2026-01-09" }]);
  });

  it("imports the once-open period on a later run, after chaodays has closed it", async () => {
    // The whole justification for skipping an open period is that it costs only
    // a re-import. Without this, "skipped" could be a permanent loss and the
    // suite would not notice.
    chaodaysClient.records = [record(2, "2026-03-20", null)];
    await runImport();
    expect(await storedDates()).toEqual([]);

    chaodaysClient.records = [record(2, "2026-03-20", "2026-03-25")];
    const summary = await runImport();

    expect(summary.imported).toBe(1);
    expect(await storedDates()).toEqual([{ startDate: "2026-03-20", endDate: "2026-03-25" }]);
  });

  it("rejects a source period that ends before it starts, without writing it", async () => {
    // Writes go through `addPeriod` rather than the repository so an import
    // cannot be a back door around the rule manual entry obeys. The adapter
    // normally rejects such a record first; this pins the second line.
    chaodaysClient.records = [record(1, "2026-01-09", "2026-01-05")];

    await expect(runImport()).rejects.toThrow(InvalidPeriodError);

    expect(menstrualRepository.addCallCount).toBe(0);
    expect(await storedDates()).toEqual([]);
  });

  it("writes only one of two source periods that overlap each other within one import", async () => {
    chaodaysClient.records = [record(1, "2026-01-05", "2026-01-09"), record(2, "2026-01-08", "2026-01-12")];

    const summary = await runImport();

    expect(summary).toEqual({ imported: 1, skipped: 1, from: "2026-01-01", to: "2026-03-31" });
    expect(await storedDates()).toEqual([{ startDate: "2026-01-05", endDate: "2026-01-09" }]);
  });

  it("adds nothing when the same import is run twice", async () => {
    chaodaysClient.records = [record(1, "2026-01-05", "2026-01-09"), record(2, "2026-02-03", "2026-02-07")];

    await runImport();
    const second = await runImport();

    expect(second).toEqual({ imported: 0, skipped: 2, from: "2026-01-01", to: "2026-03-31" });
    expect(await storedDates()).toHaveLength(2);
  });

  it("fetches a range longer than the batch size as several requests, signing in once", async () => {
    chaodaysClient.records = [record(1, "2026-01-05", "2026-01-09"), record(2, "2027-12-01", "2027-12-05")];

    const summary = await runImport("2026-01-01", "2027-12-31");

    expect(chaodaysClient.fetchCalls.length).toBeGreaterThan(1);
    expect(chaodaysClient.fetchCalls[0].from).toBe("2026-01-01");
    expect(chaodaysClient.fetchCalls[chaodaysClient.fetchCalls.length - 1].to).toBe("2027-12-31");
    expect(chaodaysClient.signInCallCount).toBe(1);
    expect(summary).toEqual({ imported: 2, skipped: 0, from: "2026-01-01", to: "2027-12-31" });
  });

  it("reports the same counts and writes whether or not the source repeats a boundary period", async () => {
    // Same range and same underlying periods in both arms — only the upstream's
    // batch-filtering behaviour differs, so any difference in the summary is the
    // batching leaking into the result.
    const periods = [
      record(1, "2026-02-01", "2026-02-05"),
      // 2026-07-02/03 is the first 183-day batch boundary, so this one spans it.
      record(2, "2026-06-30", "2026-07-05"),
      record(3, "2026-09-01", "2026-09-05"),
    ];

    chaodaysClient.records = periods;
    const withoutRepeat = await runImport("2026-01-01", "2026-12-31");
    const withoutRepeatStored = await storedDates();

    menstrualRepository = new InMemoryMenstrualRepository();
    chaodaysClient = new FakeChaodaysClient();
    chaodaysClient.records = periods;
    chaodaysClient.filterByOverlap = true;
    const withRepeat = await runImport("2026-01-01", "2026-12-31");

    expect(withRepeat).toEqual(withoutRepeat);
    expect(withRepeat).toEqual({ imported: 3, skipped: 0, from: "2026-01-01", to: "2026-12-31" });
    expect(await storedDates()).toEqual(withoutRepeatStored);
  });

  it("writes nothing when a batch after the first fails", async () => {
    // The first batch returns a period that WOULD be written, so a fetch-then-write
    // implementation cannot pass this by having had nothing to write.
    chaodaysClient.records = [record(1, "2026-01-05", "2026-01-09")];
    chaodaysClient.failOnFetchCall = 2;

    await expect(runImport("2026-01-01", "2027-12-31")).rejects.toThrow(ChaodaysUpstreamError);

    expect(chaodaysClient.fetchCalls.length).toBe(2);
    expect(menstrualRepository.addCallCount).toBe(0);
    expect(await storedDates()).toEqual([]);
  });

  it("writes that same first-batch period when no batch fails", async () => {
    // Pins the previous test's setup: the period it expects not to be written
    // really is one that would otherwise be written.
    chaodaysClient.records = [record(1, "2026-01-05", "2026-01-09")];

    const summary = await runImport("2026-01-01", "2027-12-31");

    expect(summary.imported).toBe(1);
    expect(await storedDates()).toEqual([{ startDate: "2026-01-05", endDate: "2026-01-09" }]);
  });

  it("propagates a chaodays sign-in auth failure", async () => {
    chaodaysClient.signInError = new ChaodaysAuthError();

    await expect(runImport()).rejects.toThrow(ChaodaysAuthError);
  });
});
