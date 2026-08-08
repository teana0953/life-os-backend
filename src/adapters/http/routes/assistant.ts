import type { Context } from "hono";
import { converse } from "../../../contexts/assistant/application/converse";
import type { ToolContext } from "../../../contexts/assistant/application/tools";
import type { AssistantMessage, ModelClient } from "../../../contexts/assistant/domain/model-client";
import type { FinanceBudgetRepository } from "../../../contexts/finance/domain/finance-budget-repository";
import type { FinanceCategoryRepository } from "../../../contexts/finance/domain/finance-category-repository";
import type { FinanceTransactionRepository } from "../../../contexts/finance/domain/finance-transaction-repository";
import type { BalanceRepository } from "../../../contexts/split/domain/balance-repository";
import type { UserRepository } from "../../../contexts/user/domain/user-repository";
import { localParts } from "../../../shared-kernel/reminder-clock";
import { resolveUserId } from "../current-user";
import type { AuthVariables } from "../middleware/auth";
import { BadRequestError } from "../validation";
import { resolveModelApiKey } from "./assistant-key";

export interface AssistantHandlerOptions {
  userRepository: UserRepository;
  financeTransactionRepository: FinanceTransactionRepository;
  financeCategoryRepository: FinanceCategoryRepository;
  financeBudgetRepository: FinanceBudgetRepository;
  balanceRepository: BalanceRepository;
  modelClient: ModelClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The conversation as the client sent it — roles and non-empty text, nothing else. */
function parseMessages(body: unknown): AssistantMessage[] {
  if (!isRecord(body) || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw new BadRequestError("messages must be a non-empty array");
  }
  return body.messages.map((message): AssistantMessage => {
    if (
      !isRecord(message) ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      message.content.trim() === ""
    ) {
      throw new BadRequestError("each message needs a role of user or assistant, and non-empty content");
    }
    return { role: message.role, content: message.content };
  });
}

/**
 * Protected `POST /api/assistant`: run the caller's conversation through the
 * model with the assistant's tool set, under the caller's own identity.
 *
 * The key is resolved by `resolveModelApiKey` — the one place that knows where
 * it comes from — and handed straight to the loop. `userId` comes from the
 * verified token; nothing in the body can name a different account.
 */
export function createAssistantHandler(options: AssistantHandlerOptions) {
  return async (c: Context<{ Variables: AuthVariables }>) => {
    const userId = await resolveUserId(options.userRepository, c.get("firebaseClaims"));
    const apiKey = resolveModelApiKey(c);
    const body: unknown = await c.req.json().catch(() => {
      throw new BadRequestError("body must be JSON");
    });
    const messages = parseMessages(body);

    // The caller's own date, resolved from their timezone — same shape the
    // split balances route uses.
    const timezone = (await options.userRepository.getById(userId))?.timezone ?? "Asia/Taipei";
    const today = localParts(new Date(), timezone).date;
    const context: ToolContext = {
      userId,
      today,
      defaultMonth: today.slice(0, 7),
      transactions: options.financeTransactionRepository,
      categories: options.financeCategoryRepository,
      budgets: options.financeBudgetRepository,
      balances: options.balanceRepository,
    };

    const { text, proposals } = await converse(options.modelClient, apiKey, messages, context);
    return c.json({ text, proposals });
  };
}
