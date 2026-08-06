import type { CreateFinanceCategoryInput } from "./finance-category";

/**
 * The catch-all every user has by default, and the fallback a mirrored split
 * transaction lands on when the split named no category or named one this
 * user does not have. Note it exists under **both** types below, so any
 * lookup for it must say which one it wants.
 */
export const FALLBACK_CATEGORY_NAME = "其他";

/** Default per-user categories seeded lazily on first `GET /api/finance/categories` (design.md). */
export const DEFAULT_CATEGORIES: Omit<CreateFinanceCategoryInput, "userId">[] = [
  { name: "餐飲", type: "expense", sortOrder: 0 },
  { name: "交通", type: "expense", sortOrder: 1 },
  { name: "購物", type: "expense", sortOrder: 2 },
  { name: "娛樂", type: "expense", sortOrder: 3 },
  { name: "居住", type: "expense", sortOrder: 4 },
  { name: "醫療", type: "expense", sortOrder: 5 },
  { name: "其他", type: "expense", sortOrder: 6 },
  { name: "薪資", type: "income", sortOrder: 0 },
  { name: "獎金", type: "income", sortOrder: 1 },
  { name: "利息", type: "income", sortOrder: 2 },
  { name: "其他", type: "income", sortOrder: 3 },
];
