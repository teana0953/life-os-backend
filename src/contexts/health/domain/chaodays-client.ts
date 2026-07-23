/** devise_token_auth session triple returned by chaodays sign-in, and rotated on each request. */
export interface ChaodaysSession {
  accessToken: string;
  client: string;
  uid: string;
}

/** A single day's weight record from chaodays. `weight`/`bodyFatPct` are null when chaodays has no value. */
export interface ChaodaysWeightRecord {
  /** ISO calendar date, e.g. "2026-07-18". */
  date: string;
  weight: number | null;
  bodyFatPct: number | null;
}

/** A single food item within a chaodays diet record. oil/sugar are dropped (lifeos has no such axes). */
export interface ChaodaysDietItem {
  name: string;
  staple: number;
  meat: number;
  fruit: number;
  veg: number;
}

/** A single chaodays diet record (one meal-type entry on a day; a day can have several of the same type). */
export interface ChaodaysDietRecord {
  /** ISO calendar date, e.g. "2026-07-18". */
  date: string;
  recordType: "breakfast" | "lunch" | "dinner" | "extra";
  /** "YYYY-MM-DD HH:mm". */
  recordedAt: string;
  items: ChaodaysDietItem[];
}

/** A single chaodays water record (one drink logged; a day can have several). */
export interface ChaodaysWaterRecord {
  /** ISO calendar date, e.g. "2026-07-18". */
  date: string;
  waterMl: number;
  /** "YYYY-MM-DD HH:mm". */
  recordedAt: string;
}

/** A single chaodays defecation record (a day can have several). */
export interface ChaodaysDefecationRecord {
  /** ISO calendar date, e.g. "2026-07-18". */
  date: string;
  count: number;
  isAbnormality: boolean;
  note: string;
}

/** Driven port for the external chaodays API. */
export interface ChaodaysClient {
  signIn(uid: string, password: string): Promise<ChaodaysSession>;
  /** Returns the rotated session (devise token rotates each response) alongside the records. */
  fetchWeightRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysWeightRecord[] }>;
  /** Returns the rotated session (devise token rotates each response) alongside the records. */
  fetchDietRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysDietRecord[] }>;
  /** Returns the rotated session (devise token rotates each response) alongside the records. */
  fetchWaterRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysWaterRecord[] }>;
  /** Returns the rotated session (devise token rotates each response) alongside the records. */
  fetchDefecationRecords(
    session: ChaodaysSession,
    from: string,
    to: string,
  ): Promise<{ session: ChaodaysSession; records: ChaodaysDefecationRecord[] }>;
}

/** chaodays rejected the sign-in (wrong uid/password). Message is fixed and generic — never embeds credentials. */
export class ChaodaysAuthError extends Error {
  constructor() {
    super("chaodays authentication failed");
  }
}

/** chaodays request failed for a non-auth reason (non-200 response or network failure). */
export class ChaodaysUpstreamError extends Error {
  constructor() {
    super("chaodays upstream request failed");
  }
}
