export interface BudgetAlertMessage {
  title: string;
  body: string;
}

/**
 * Port: lets finance notify a user of a budget-threshold crossing without
 * `finance/domain` or `finance/application` importing the notifications
 * context directly (design.md — cross-context boundary). The message text
 * is built by `checkBudgetAlerts` (application layer); implementations only
 * handle delivery.
 */
export interface BudgetAlertNotifier {
  notify(userId: string, message: BudgetAlertMessage): Promise<void>;
}
