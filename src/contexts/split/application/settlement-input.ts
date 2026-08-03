export interface CreateSettlementInput {
  callerUserId: string;
  groupId: string | null;
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  day: string;
  note: string | null;
}
