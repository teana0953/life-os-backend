/** A net-worth account's fixed macro-class: an asset holds value, a liability is a debt (both snapshot values are stored positive; liabilities subtract when computing net worth). Immutable after creation. */
export type NetWorthKind = "asset" | "liability";

export type ExposureFactor = 0 | 1 | 2 | 3;

export function isExposureFactor(value: unknown): value is ExposureFactor {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export interface NetWorthAccount {
  id: string;
  userId: string;
  kind: NetWorthKind;
  name: string;
  sortOrder: number;
  archived: boolean;
  exposureFactor: ExposureFactor | null;
}

export interface CreateNetWorthAccountInput {
  userId: string;
  kind: NetWorthKind;
  name: string;
  sortOrder?: number;
}

/** Partial-update patch: `kind` is intentionally absent — an account's kind is immutable after creation. */
export interface UpdateNetWorthAccountPatch {
  name?: string;
  sortOrder?: number;
  archived?: boolean;
  exposureFactor?: ExposureFactor | null;
}
