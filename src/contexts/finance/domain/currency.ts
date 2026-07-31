/** Supported ISO 4217 currencies (design.md whitelist), always uppercase. */
export const SUPPORTED_CURRENCIES = ["TWD", "USD", "JPY", "EUR", "CNY", "KRW", "GBP", "HKD", "AUD", "CAD"] as const;

export const DEFAULT_CURRENCY = "TWD";

export function isSupportedCurrency(value: string): boolean {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
