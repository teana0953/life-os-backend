export interface CurrencyBalance {
  currency: string;
  /** Positive = they owe the viewer; negative = the viewer owes them. Never zero — zero-net currencies are omitted (design.md). */
  amount: number;
}

/** Outward-facing net balance against one other person (personal) or one member's net against a whole group (group balances). */
export interface Balance {
  userId: string;
  displayName: string;
  balances: CurrencyBalance[];
}
