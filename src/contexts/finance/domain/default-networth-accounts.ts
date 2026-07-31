import type { CreateNetWorthAccountInput } from "./networth-account";

/** Default per-user net-worth accounts seeded lazily on first `GET /api/finance/networth/accounts` (design.md). */
export const DEFAULT_NETWORTH_ACCOUNTS: Omit<CreateNetWorthAccountInput, "userId">[] = [
  { kind: "asset", name: "台幣活存", sortOrder: 0 },
  { kind: "asset", name: "台幣定存", sortOrder: 1 },
  { kind: "asset", name: "外幣", sortOrder: 2 },
  { kind: "asset", name: "股票", sortOrder: 3 },
  { kind: "asset", name: "基金", sortOrder: 4 },
  { kind: "asset", name: "儲蓄險", sortOrder: 5 },
  { kind: "liability", name: "房貸或房租", sortOrder: 0 },
  { kind: "liability", name: "信用卡", sortOrder: 1 },
  { kind: "liability", name: "學貸", sortOrder: 2 },
  { kind: "liability", name: "其他負債", sortOrder: 3 },
];
