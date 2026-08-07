import type { Context } from "hono";
import { addGroupMember } from "../../../contexts/split/application/add-group-member";
import { archiveGroup } from "../../../contexts/split/application/archive-group";
import { createExpense } from "../../../contexts/split/application/create-expense";
import { createGroup } from "../../../contexts/split/application/create-group";
import { createSettlement } from "../../../contexts/split/application/create-settlement";
import { deleteExpense } from "../../../contexts/split/application/delete-expense";
import { deleteSettlement } from "../../../contexts/split/application/delete-settlement";
import type { SplitInput } from "../../../contexts/split/application/expense-input";
import { getBalances } from "../../../contexts/split/application/get-balances";
import { getExpense } from "../../../contexts/split/application/get-expense";
import { getGroup } from "../../../contexts/split/application/get-group";
import { getGroupBalances } from "../../../contexts/split/application/get-group-balances";
import { listActivity } from "../../../contexts/split/application/list-activity";
import { listExpenses } from "../../../contexts/split/application/list-expenses";
import { listMyGroups } from "../../../contexts/split/application/list-my-groups";
import { listSettlements } from "../../../contexts/split/application/list-settlements";
import { updateExpense } from "../../../contexts/split/application/update-expense";
import type { Balance } from "../../../contexts/split/domain/balance";
import type { BalanceRepository } from "../../../contexts/split/domain/balance-repository";
import {
  AlreadyAGroupMember,
  CannotSettleWithSelf,
  DuplicateParticipant,
  ExpenseNotFound,
  GroupArchived,
  GroupNotFound,
  InvalidSplitInput,
  NotAGroupMember,
  NotAParticipant,
  NotFriends,
  SettlementNotFound,
  SharesDoNotSumToAmount,
  SplitTooSmall,
} from "../../../contexts/split/domain/errors";
import type { ExpenseGroup, GroupMember } from "../../../contexts/split/domain/expense-group";
import type { ExpenseGroupRepository } from "../../../contexts/split/domain/expense-group-repository";
import type { FriendChecker } from "../../../contexts/split/domain/friend-checker";
import type { Settlement } from "../../../contexts/split/domain/settlement";
import type { SplitActivity } from "../../../contexts/split/domain/split-activity";
import type { SplitActivityRepository } from "../../../contexts/split/domain/split-activity-repository";
import type { ListSettlementsFilter, SettlementRepository } from "../../../contexts/split/domain/settlement-repository";
import type { SharesMirror } from "../../../contexts/split/domain/shares-mirror";
import type { SplitExpense } from "../../../contexts/split/domain/split-expense";
import type { ListExpensesFilter, SplitExpenseRepository } from "../../../contexts/split/domain/split-expense-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { localParts } from "../../../shared-kernel/reminder-clock";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError, requireDay, requireString } from "../validation";

export interface SplitHandlerOptions {
  userRepository: UserRepository;
  expenseGroupRepository: ExpenseGroupRepository;
  splitExpenseRepository: SplitExpenseRepository;
  balanceRepository: BalanceRepository;
  friendChecker: FriendChecker;
  settlementRepository: SettlementRepository;
  splitActivityRepository: SplitActivityRepository;
  sharesMirror: SharesMirror;
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
  if (err instanceof SettlementNotFound) return c.json({ error: "not_found" }, 404);
  if (err instanceof CannotSettleWithSelf) return c.json({ error: "cannot_settle_with_self" }, 400);
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
  return { group_id: member.groupId, user_id: member.userId, display_name: member.displayName, joined_at: member.joinedAt.toISOString() };
}

function expenseToJson(expense: SplitExpense) {
  return {
    id: expense.id,
    group_id: expense.groupId,
    payer_user_id: expense.payerUserId,
    payer_display_name: expense.payerDisplayName,
    created_by_user_id: expense.createdByUserId,
    amount: expense.amount,
    currency: expense.currency,
    description: expense.description,
    day: expense.day,
    split_mode: expense.splitMode,
    category_name: expense.categoryName,
    shares: expense.shares.map((share) => ({
      user_id: share.userId,
      display_name: share.displayName,
      amount: share.amount,
      // Absent for an unscheduled share, and present in the same spelling the
      // write side accepts: an edit re-sends what it read, and a client that
      // could not read the schedule would necessarily drop it.
      ...(share.schedule
        ? { schedule: { periods: share.schedule.periods, per_period_amount: share.schedule.perPeriodAmount } }
        : {}),
    })),
    created_at: expense.createdAt.toISOString(),
    updated_at: expense.updatedAt.toISOString(),
  };
}

function balanceToJson(balance: Balance) {
  return {
    user_id: balance.userId,
    display_name: balance.displayName,
    balances: balance.balances.map((b) => ({
      currency: b.currency,
      amount: b.amount,
      // Absent, not zeroed, when nothing behind this figure is on a schedule
      // (split-installments tasks 4.1/4.2) — a zeroed value would be
      // indistinguishable from "the schedule finished".
      // A list, one entry per scheduled expense: the same counterpart can owe
      // on two scheduled expenses in the same currency.
      ...(b.schedules
        ? {
            schedules: b.schedules.map((s) => ({
              expense_id: s.expenseId,
              next_period: s.nextPeriod,
              total_periods: s.totalPeriods,
              period_amount: s.periodAmount,
            })),
          }
        : {}),
    })),
  };
}

function settlementToJson(settlement: Settlement) {
  return {
    id: settlement.id,
    group_id: settlement.groupId,
    from_user_id: settlement.fromUserId,
    from_display_name: settlement.fromDisplayName,
    to_user_id: settlement.toUserId,
    to_display_name: settlement.toDisplayName,
    amount: settlement.amount,
    currency: settlement.currency,
    day: settlement.day,
    note: settlement.note,
    created_by_user_id: settlement.createdByUserId,
    created_at: settlement.createdAt.toISOString(),
    updated_at: settlement.updatedAt.toISOString(),
  };
}

/**
 * Everything a client needs to render the entry, including who did it — the
 * reader compares `actor_user_id` against their own id to say "you" instead of
 * a name (design.md D5), so no second call is needed to find out who they are.
 * Fields that do not apply to an event type are `null` rather than absent, so
 * the shape never changes between entries.
 */
function activityToJson(entry: SplitActivity) {
  return {
    id: entry.id,
    type: entry.type,
    actor_user_id: entry.actorUserId,
    actor_display_name: entry.actorDisplayName,
    group_id: entry.groupId,
    group_name: entry.groupName,
    subject_id: entry.subjectId,
    counterpart_user_id: entry.counterpartUserId,
    counterpart_display_name: entry.counterpartDisplayName,
    amount: entry.amount,
    previous_amount: entry.previousAmount,
    // A settlement's direction, relative to the actor — the client turns the
    // pair (`actor_is_payer`, whether the reader is the actor) into "you paid
    // Ben" or "Ben paid you". `null` on every non-settlement type.
    actor_is_payer: entry.actorIsPayer,
    currency: entry.currency,
    description: entry.description,
    created_at: entry.createdAt.toISOString(),
  };
}

/** `note` is optional and nullable: absent or `null` -> `null`, a non-string throws 400. */
function optionalNoteField(body: Record<string, unknown>): string | null {
  if (body.note === undefined || body.note === null) return null;
  if (typeof body.note !== "string") throw new BadRequestError("note must be a string or null");
  return body.note;
}

/**
 * Reads an exact share's optional repayment schedule (split-installments
 * proposal.md): `{ periods, per_period_amount }`. Absent or `null` -> no
 * schedule; anything else must be a well-shaped object, so a caller's typo
 * fails loudly here rather than silently mirroring as an ordinary lump share.
 */
function parseShareSchedule(value: unknown, field: string): { periods: number; perPeriodAmount: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new BadRequestError(`${field} must be an object or null`);
  const schedule = value as Record<string, unknown>;
  const periods = requireAmountNumber(schedule.periods, `${field}.periods`);
  if (!Number.isInteger(periods) || periods <= 0) throw new BadRequestError(`${field}.periods must be a positive integer`);
  const perPeriodAmount = requireAmountNumber(schedule.per_period_amount, `${field}.per_period_amount`);
  if (!Number.isInteger(perPeriodAmount) || perPeriodAmount <= 0) throw new BadRequestError(`${field}.per_period_amount must be a positive integer`);
  return { periods, perPeriodAmount };
}

/**
 * Reads `split` out of the request body: `{ mode: "equal", participant_user_ids: [...] }`
 * or `{ mode: "exact", shares: [{ user_id, amount, schedule? }] }`. Every user
 * id inside is checked against `UUID_RE` here — a malformed one in the body
 * is a `400` (design.md), not a `500` from Postgres' uuid cast further down.
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
      const schedule = parseShareSchedule(share.schedule, `split.shares[${index}].schedule`);
      // If a schedule is provided, validate that periods * per_period_amount equals the share amount
      if (schedule) {
        const scheduledTotal = schedule.periods * schedule.perPeriodAmount;
        if (scheduledTotal !== amount) {
          throw new BadRequestError(
            `split.shares[${index}].schedule: periods (${schedule.periods}) × per_period_amount (${schedule.perPeriodAmount}) = ${scheduledTotal}, but share amount is ${amount}`,
          );
        }
      }
      return { userId, amount, schedule };
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
  categoryName: unknown;
  split: SplitInput;
}

function expenseFieldsFromBody(body: Record<string, unknown>): ExpenseFieldsFromBody {
  return {
    payerUserId: requireUuidBodyField(body, "payer_user_id"),
    amount: requireAmountNumber(body.amount, "amount"),
    currency: requireString(body.currency, "currency"),
    description: requireString(body.description, "description"),
    day: requireDay(body.day, "day"),
    // Passed through unchecked: `validateExpenseFields` owns every rule about
    // it (type, empty-means-none, length cap), so creating and editing can
    // never disagree about what a category name may be.
    categoryName: body.category_name,
    split: parseSplitInput(body.split),
  };
}

/** Protected `GET /api/split/groups`: the caller's groups. */
export function createListMyGroupsHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const groups = await listMyGroups(options.expenseGroupRepository, userId);
    return c.json({
      groups: groups.map((entry) => ({ ...groupToJson(entry.group), members: entry.members.map(memberToJson) })),
    });
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
        { expenses: options.splitExpenseRepository, groups: options.expenseGroupRepository, friends: options.friendChecker, mirror: options.sharesMirror },
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
        { expenses: options.splitExpenseRepository, groups: options.expenseGroupRepository, friends: options.friendChecker, mirror: options.sharesMirror },
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

/**
 * Protected `GET /api/split/activity?limit=&cursor=`: the caller's timeline,
 * newest first. `cursor` is the opaque `next_cursor` of the previous page; a
 * malformed one is caller-supplied filtering input, so 400 like `with=`.
 */
export function createListActivityHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));

    const limitParam = c.req.query("limit");
    const cursorParam = c.req.query("cursor");
    const input: { limit?: number; cursor?: string } = {};
    if (limitParam !== undefined) {
      const limit = Number(limitParam);
      if (!Number.isInteger(limit) || limit <= 0) throw new BadRequestError("limit must be a positive integer");
      input.limit = limit;
    }
    if (cursorParam !== undefined) input.cursor = cursorParam;

    try {
      const page = await listActivity(options.splitActivityRepository, userId, input);
      return c.json({ activity: page.entries.map(activityToJson), next_cursor: page.nextCursor });
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/** Protected `GET /api/split/balances`: the caller's net against everyone they share an expense with, per currency. */
export function createGetBalancesHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    // The caller's own date, resolved here rather than in SQL — see
    // `BalanceRepository.balancesForUser`. Same shape finance uses for its
    // own date-sensitive gates.
    const timezone = (await options.userRepository.getById(userId))?.timezone ?? "Asia/Taipei";
    const balances = await getBalances(options.balanceRepository, userId, localParts(new Date(), timezone).date);
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

/** Protected `POST /api/split/settlements`: records a repayment. Same anti-fabrication posture as expense creation — the caller must be the payer or the payee. */
export function createCreateSettlementHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    const groupId = optionalUuidBodyField(body, "group_id");
    const fromUserId = requireUuidBodyField(body, "from_user_id");
    const toUserId = requireUuidBodyField(body, "to_user_id");
    const amount = requireAmountNumber(body.amount, "amount");
    const currency = requireString(body.currency, "currency");
    const day = requireDay(body.day, "day");
    const note = optionalNoteField(body);

    try {
      const settlement = await createSettlement(
        { settlements: options.settlementRepository, groups: options.expenseGroupRepository, friends: options.friendChecker },
        { callerUserId: userId, groupId, fromUserId, toUserId, amount, currency, day, note },
      );
      return c.json(settlementToJson(settlement), 201);
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/**
 * Protected `GET /api/split/settlements?group_id=&with=`. Same filtering
 * semantics and malformed-id handling as `GET /api/split/expenses`: a
 * malformed `group_id` is 404 (it names a specific group), a malformed `with`
 * is 400 (caller-supplied filtering input).
 */
export function createListSettlementsHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));

    const groupIdParam = c.req.query("group_id");
    const withParam = c.req.query("with");
    if (groupIdParam !== undefined && !UUID_RE.test(groupIdParam)) return c.json({ error: "not_found" }, 404);
    if (withParam !== undefined && !UUID_RE.test(withParam)) throw new BadRequestError("with must be a uuid");

    const filter: ListSettlementsFilter = {};
    if (groupIdParam !== undefined) filter.groupId = groupIdParam;
    if (withParam !== undefined) filter.withUserId = withParam;

    try {
      const settlements = await listSettlements({ settlements: options.settlementRepository, groups: options.expenseGroupRepository }, userId, filter);
      return c.json({ settlements: settlements.map(settlementToJson) });
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}

/** Protected `DELETE /api/split/settlements/:id`: only the creator or the payer (`from_user_id`) may delete; every other caller gets 404 — never 403. */
export function createDeleteSettlementHandler(options: SplitHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const settlementId = requireUuidParam(c, "id");
    if (!settlementId) return c.json({ error: "not_found" }, 404);

    try {
      await deleteSettlement(options.settlementRepository, userId, settlementId);
      return c.json({ deleted: true });
    } catch (err) {
      return mapSplitError(err, c);
    }
  };
}
