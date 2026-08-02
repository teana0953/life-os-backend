/**
 * Whether `value` is three uppercase ASCII letters (e.g. `TWD`). Unlike
 * finance's currency, split does not restrict to a fixed whitelist
 * (design.md: "幣別非三碼大寫 → 400").
 */
export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}
