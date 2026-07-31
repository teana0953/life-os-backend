import { isSupportedCurrency } from "../domain/currency";
import { InvalidFinanceInputError } from "../domain/errors";
import type { FinanceTransactionType } from "../domain/finance-transaction";

/**
 * Validates the fields shared by create and full-replace update: `amount`
 * must be a positive integer, `type` must be a known category type, and
 * `currency` must be in the whitelist (case-insensitive input, normalized to
 * uppercase on return).
 */
export function validateTransactionFields(type: string, amount: number, currency: string): { type: FinanceTransactionType; currency: string } {
  if (type !== "expense" && type !== "income") {
    throw new InvalidFinanceInputError(`type must be "expense" or "income": ${type}`);
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new InvalidFinanceInputError(`amount must be a positive integer: ${amount}`);
  }
  const normalizedCurrency = currency.toUpperCase();
  if (!isSupportedCurrency(normalizedCurrency)) {
    throw new InvalidFinanceInputError(`currency is not supported: ${currency}`);
  }
  return { type, currency: normalizedCurrency };
}
