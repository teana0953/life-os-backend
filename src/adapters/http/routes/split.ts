import type { Context } from "hono";
import { addGroupMember } from "../../../contexts/split/application/add-group-member";
import { archiveGroup } from "../../../contexts/split/application/archive-group";
import { createExpense } from "../../../contexts/split/application/create-expense";
import { createGroup } from "../../../contexts/split/application/create-group";
import { deleteExpense } from "../../../contexts/split/application/delete-expense";
import type { SplitInput } from "../../../contexts/split/application/expense-input";
import { getBalances } from "../../../contexts/split/application/get-balances";
import { getExpense } from "../../../contexts/split/application/get-expense";
import { getGroup } from "../../../contexts/split/application/get-group";
import { getGroupBalances } from "../../../contexts/split/application/get-group-balances";
import { listExpenses } from "../../../contexts/split/application/list-expenses";
import { listMyGroups } from "../../../contexts/split/application/list-my-groups";
import { updateExpense } from "../../../contexts/split/application/update-expense";
import type { Balance } from "../../../contexts/split/domain/balance";
import type { BalanceRepository } from "../../../contexts/split/domain/balance-repository";
import {
  AlreadyAGroupMember,
  DuplicateParticipant,
  ExpenseNotFound,
  GroupArchived,
  GroupNotFound,
  InvalidSplitInput,
  NotAGroupMember,
  NotAParticipant,
  NotFriends,
  SharesDoNotSumToAmount,
  SplitTooSmall,
} from "../../../contexts/split/domain/errors";
import type { ExpenseGroup, GroupMember } from "../../../contexts/split/domain/expense-group";
import type { ExpenseGroupRepository } from "../../../contexts/split/domain/expense-group-repository";
import type { FriendChecker } from "../../../contexts/split/domain/friend-checker";
import type { SplitExpense } from "../../../contexts/split/domain/split-expense";
import type { ListExpensesFilter, SplitExpenseRepository } from "../../../contexts/split/domain/split-expense-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireDay, requireString } from "../validation";

export interface SplitHandlerOptions {
  userRepository: UserRepository;
  expenseGroupRepository: ExpenseGroupRepository;
  splitExpenseRepository: SplitExpenseRepository;
  balanceRepository: BalanceRepository;
  friendChecker: FriendChecker;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A money amount, which must arrive as a JSON number. The shared
 * `requireFiniteNumber` coerces numeric strings (`"100"` -> `100`, `"1e3"` ->
 * `1000`), and other contexts already depend on that; tightening the shared
 * helper would change behaviour repo-wide. Split states the stricter rule
 * ("Amounts SHALL be integers in the currency's minor units ... Anything else
 * SHALL be rejected"), so it is enforced locally here instead. Integer-ness
 * itself stays with the domain, which owns the money rules.
 */
function requireAmountNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BadRequestError(`${field} must be a number`);
  return value;
}

function requireUuidParam(c: Context, name: string): string | null {
  const value = c.req.param(name) ?? "";
  return UUID_RE.test(value) ? value : null;
}

/**
 * Maps this context's typed errors to HTTP, modelled on `mapSocialError` in
 * `routes/friends.ts`. `app.ts`'s `onError` only recognises `BadRequestError`
 * and 500s everything else — without this mapper, `GroupNotFound`/
 * `ExpenseNotFound` would surface as 500 instead of 404, and the change's core
 * visibility rule would silently not work. Visibility failures are always
 * 404, never 403 (design.md: a 403 admits the id exists).
 */
function mapSplitError(err: unknown, c: Context): Response {
  if (err instanceof GroupNotFound || err instanceof ExpenseNotFound) {
    return c.json({ error: "not_found" }, 404);
  }
  if (err instanceof SharesDoNotSumToAmount) {
    return c.json({ error: "shares_do_not_sum_to_amount", message: err.message }, 400);
  }
  if (err instanceof NotAParticipant) return c.json({ error: "not_a_participant" }, 400);
  if (err instanceof NotFriends) return c.json({ error: "not_friends" }, 400);
  if (err instanceof NotAGroupMember) return c.json({ error: "not_a_group_member" }, 400);
  if (err instanceof GroupArchived) return c.json({ error: "group_archived" }, 400);
  if (err instanceof SplitTooSmall) return c.json({ error: "split_too_small" }, 400);
  if (err instanceof DuplicateParticipant) return c.json({ error: "duplicate_participant" }, 400);
  if (err instanceof AlreadyAGroupMember) return c.json({ error: "already_a_group_member" }, 400);
  if (err instanceof InvalidSplitInput) return c.json({ error: "invalid_split_input", message: err.message }, 400);
  throw err;
}

function groupToJson(group: ExpenseGroup) {
  return {
    id: group.id,
    name: group.name,
    created_by_user_id: group.createdByUserId,
    archived_at: group.archivedAt ? group.archivedAt.toISOString() : null,
    created_at: group.createdAt.toISOString(),
    updated_at: group.updatedAt.toISOString(),
  };
}

function memberToJson(member: GroupMember) {
  return { group_id: member.groupId, user_id: member.userId, joined_at: member.joinedAt.toISOString() };
}

function expenseToJson(expense: SplitExpense) {
  return {
    id: expense.id,
    group_id: expense.groupId,
    payer_user_id: expense.payerUserId,
    created_by_user_id: expense.createdByUserId,
    amount: expense.amount,
    currency: expense.currency,
    description: expense.description,
    day: expense.day,
    split_mode: expense.splitMode,
    shares: expense.shares.map((share) => ({ user_id: share.userId, amount: share.amount })),
    created_at: expense.createdAt.toISOString(),
    updated_at: expense.updatedAt.toISOString(),
  };
}

function balanceToJson(balance: Balance) {
  return {
    user_id: balance.userId,
    display_name: balance.displayName,
    balances: balance.balances.map((b) => ({ currency: b.currency, amount: b.amount })),
  };
}

/**
 * Reads `split` out of the request body: `{ mode: "equal", participant_user_ids: [...] }`
 * or `{ mode: "exact", shares: [{ user_id, amount }] }`. Every user id inside
 * is checked against `UUID_RE` here — a malformed one in the body is a `400`
 * (design.md), not a `500` from Postgres' uuid cast further down.
 */
function parseSplitInput(value: unknown): SplitInput {
  if (typeof value !== "object" || value === null) throw new BadRequestError("split is required");
  const body = value as Record<string, unknown>;

  if (body.mode === "equal") {
    if (!Array.isArray(body.participant_user_ids) || body.participant_user_ids.some((id) => typeof id !== "string")) {
      throw new BadRequestError("split.participant_user_ids must be an array of strings");
    }
    const ids = body.participant_user_ids as string[];
    for (const id of ids) {
      if (!UUID_RE.test(id)) throw new BadRequestError("split.participant_user_ids must contain only uuids");
    }
    return { mode: "equal", participantUserIds: ids };
  }

  if (body.mode === "exact") {
    if (!Array.isArray(body.shares)) throw new BadRequestError("split.shares must be an array");
    const shares = body.shares.map((raw, index) => {
      if (typeof raw !== "object" || raw === null) throw new BadRequestError(`split.shares[${index}] is invalid`);
      const share = raw as Record<string, unknown>;
      const userId = requireString(share.user_id, `split.shares[${index}].user_id`);
      if (!UUID_RE.test(userId)) throw new BadRequestError(`split.shares[${index}].user_id must be a uuid`);
      const amount = requireAmountNumber(share.amount, `split.shares[${index}].amount`);
      return { userId, amount };
    });
    return { mode: "exact", shares };
  }

  throw new BadRequestError("split.mode must be 'equal' or 'exact'");
}

function requireUuidBodyField(body: Record<string, unknown>, field: string): string {
  const value = requireString(body[field], field);
  if (!UUID_RE.test(value)) throw new BadRequestError(`${field} must be a uuid`);
  return value;
}

function optionalUuidBodyField(body: Record<string, unknown>, field: string): string | null {
  if (body[field] === undefined || body[field] === null) return null;
  return requireUuidBodyField(body, field);
}

interface ExpenseFieldsFromBody {
  payerUserId: string;
  amount: number;
  currency: string;
  description: string;
  day: string;
  split: SplitInput;
}

function expenseFieldsFromBody(body: Record<string, unknown>): ExpenseFieldsFromBody {
  return {
    payerUserId: requireUuidBodyField(body, "payer_user_id"),
    amount: requireAmountNumber(body.amount, "amount"),
    currency: requireString(body.currency, "currency"),
    description: requireString(body.description, "description"),
    day: requireDay(body.day, "day"),
    split: parseSplitInput(body.split),
  };
}

/** Protected `GET /api/split/groups`: the caller's groups. */
export function createListMyGroupsHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const groups = await listMyGroups(options.expenseGroupRepository, userId);
    return c.json({ groups: groups.map(groupToJson) });
  };
}

/** Protected `POST /api/split/groups`: creates a group; the caller becomes its first member. */
export function createCreateGroupHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const name = requireString(body.name, "name");
    const group = await createGroup(options.expenseGroupRepository, name, userId);
    return c.json(groupToJson(group), 201);
  };
}

/** Protected `GET /api/split/groups/:id`: group details + membership; non-members get 404. */
export function createGetGroupHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const groupId = requireUuidParam(c, "id");
    if (!groupId) return c.json({ error: "not_found" }, 404);

    try {
      const details = await getGroup(options.expenseGroupRepository, userId, groupId);
      return c.json({ group: groupToJson(details.group), members: details.members.map(memberToJson) });
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/** Protected `POST /api/split/groups/:id/members`: adds an existing friend to the group. */
export function createAddGroupMemberHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const groupId = requireUuidParam(c, "id");
    if (!groupId) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const newUserId = requireUuidBodyField(body, "user_id");

    try {
      const member = await addGroupMember({ groups: options.expenseGroupRepository, friends: options.friendChecker }, userId, groupId, newUserId);
      return c.json(memberToJson(member), 201);
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/** Protected `DELETE /api/split/groups/:id`: archives the group; only its creator may. */
export function createArchiveGroupHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const groupId = requireUuidParam(c, "id");
    if (!groupId) return c.json({ error: "not_found" }, 404);

    try {
      await archiveGroup(options.expenseGroupRepository, userId, groupId);
      return c.json({ archived: true });
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/** Protected `POST /api/split/expenses`: records a new split expense. */
export function createCreateExpenseHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const groupId = optionalUuidBodyField(body, "group_id");
    const fields = expenseFieldsFromBody(body);

    try {
      const expense = await createExpense(
        { expenses: options.splitExpenseRepository, groups: options.expenseGroupRepository, friends: options.friendChecker },
        { callerUserId: userId, groupId, ...fields },
      );
      return c.json(expenseToJson(expense), 201);
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/** Protected `GET /api/split/expenses/:id`: visible only to a participant. */
export function createGetExpenseHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const expenseId = requireUuidParam(c, "id");
    if (!expenseId) return c.json({ error: "not_found" }, 404);

    try {
      const expense = await getExpense({ expenses: options.splitExpenseRepository, groups: options.expenseGroupRepository }, userId, expenseId);
      return c.json(expenseToJson(expense));
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/**
 * Protected `GET /api/split/expenses?group_id=&with=`. A malformed `group_id`
 * behaves like a malformed path id (404, since it names a specific group); a
 * malformed `with` is caller-supplied filtering input (400). Supplying both
 * is left to `listExpenses`, which rejects it as ambiguous (400).
 */
export function createListExpensesHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));

    const groupIdParam = c.req.query("group_id");
    const withParam = c.req.query("with");
    if (groupIdParam !== undefined && !UUID_RE.test(groupIdParam)) return c.json({ error: "not_found" }, 404);
    if (withParam !== undefined && !UUID_RE.test(withParam)) throw new BadRequestError("with must be a uuid");

    const filter: ListExpensesFilter = {};
    if (groupIdParam !== undefined) filter.groupId = groupIdParam;
    if (withParam !== undefined) filter.withUserId = withParam;

    try {
      const expenses = await listExpenses({ expenses: options.splitExpenseRepository, groups: options.expenseGroupRepository }, userId, filter);
      return c.json({ expenses: expenses.map(expenseToJson) });
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/** Protected `PATCH /api/split/expenses/:id`: only the creator or payer may edit; reruns every creation rule. */
export function createUpdateExpenseHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const expenseId = requireUuidParam(c, "id");
    if (!expenseId) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const groupId = body.group_id === undefined ? undefined : optionalUuidBodyField(body, "group_id");
    const fields = expenseFieldsFromBody(body);

    try {
      const expense = await updateExpense(
        { expenses: options.splitExpenseRepository, groups: options.expenseGroupRepository, friends: options.friendChecker },
        userId,
        expenseId,
        { ...fields, groupId },
      );
      return c.json(expenseToJson(expense));
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/** Protected `DELETE /api/split/expenses/:id`: only the creator or payer may delete. */
export function createDeleteExpenseHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const expenseId = requireUuidParam(c, "id");
    if (!expenseId) return c.json({ error: "not_found" }, 404);

    try {
      await deleteExpense(options.splitExpenseRepository, userId, expenseId);
      return c.json({ deleted: true });
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/** Protected `GET /api/split/balances`: the caller's net against everyone they share an expense with, per currency. */
export function createGetBalancesHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const balances = await getBalances(options.balanceRepository, userId);
    return c.json({ balances: balances.map(balanceToJson) });
  };
}

/** Protected `GET /api/split/groups/:id/balances`: every member's net against the whole group; non-members get 404. */
export function createGetGroupBalancesHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const groupId = requireUuidParam(c, "id");
    if (!groupId) return c.json({ error: "not_found" }, 404);

    try {
      const balances = await getGroupBalances({ balances: options.balanceRepository, groups: options.expenseGroupRepository }, userId, groupId);
      return c.json({ balances: balances.map(balanceToJson) });
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}
