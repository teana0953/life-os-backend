/** A transaction/category referenced a category that doesn't exist, or belongs to another user (route maps this to 404, never leaking existence). */
export class FinanceCategoryNotFound extends Error {}

/** A transaction tried to use (create) or switch onto (update) an archived category (route maps this to 400). */
export class FinanceCategoryArchived extends Error {}

/** A transaction's `type` doesn't match its category's `type` (route maps this to 400). */
export class FinanceCategoryTypeMismatch extends Error {}

/** A transaction doesn't exist, or belongs to another user (route maps this to 404). */
export class FinanceTransactionNotFound extends Error {}

/** Generic validation failure (amount, currency, category type enum, duplicate category name) (route maps this to 400). */
export class InvalidFinanceInputError extends Error {}

/** A budget doesn't exist, or belongs to another user (route maps this to 404). */
export class FinanceBudgetNotFound extends Error {}

/**
 * A transaction mirrored from a split expense was asked to change one of the
 * split's own facts — its amount, date, currency or type — or to be deleted
 * (design.md D7). Mapped to 400 rather than 404 or 409: the row exists and
 * the caller owns it, so hiding it would be a lie, and every other typed
 * error in this context already answers 400 through the same boundary.
 */
export class MirroredTransactionReadOnly extends Error {}
