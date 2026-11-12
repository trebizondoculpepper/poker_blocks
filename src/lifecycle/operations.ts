/**
 * The resolving action's operation counter (#657, #661 review): installed for the whole of a
 * committed action by `GameRun.transact`, so every rule, reaction matcher and result handler
 * evaluated inside it is charged to the action's shared budget, matched or not. Outside an action
 * (previews, trial scoring, the reward ledger's preview) nothing is installed and nothing counts.
 */
let counter: ((registration: string) => void) | null = null;

/** Charge one handler invocation to the resolving action, if one is resolving. */
export function countOperation(registration: string): void {
  counter?.(registration);
}

/** Run `body` with `operate` as the counter, restoring the previous one afterwards. */
export function withOperationCounter<T>(
  operate: ((registration: string) => void) | undefined,
  body: () => T,
): T {
  const previous = counter;
  counter = operate ?? null;
  try {
    return body();
  } finally {
    counter = previous;
  }
}
