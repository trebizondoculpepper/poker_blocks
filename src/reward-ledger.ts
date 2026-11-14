/**
 * The stage-won ledger count-up on the shared visual-event scheduler (#950, part of #531;
 * doc/result-menus.md, "Bounded completion", and doc/game-architecture.md, "Visual-event
 * scheduler and game-time units"). Presentation only: the reward was paid and saved before the
 * screen opened, so nothing here grants, pays or reads the run.
 *
 * - **One scope per showing,** holding each captured row in ledger order, one row step apart, and
 *   then the finish, which shows the totals and offers the next choice exactly once.
 * - **Captured rows:** each row's label, value text and cue are written by its registered
 *   presentation when the screen opens, so a delayed row shows what was paid, never live state.
 * - **Fallback:** a scope that fails, or can't be admitted, shows the captured ledger at once and
 *   still finishes, so the next choice never waits forever.
 * - **Cancellation:** closing the screen cancels the scope; nothing shows or plays afterwards.
 */
import type { SoundEffectId } from "./audio/sfx-registry";
import { rewardPresentations } from "./reward-presentation";
import type { StageReward } from "./stage-rewards";
import {
  visualFallbacks,
  visualHandlers,
  unitMs,
  type ScopeHandle,
  type VisualScheduler,
} from "./visual-events/scheduler";

/** One ledger row as shown: its label, its value text and the cue it plays as it appears. */
export type LedgerRow = { label: string; value: string; cue: SoundEffectId };
/** The ledger's totals line: what the stage paid in all, and the balance after. */
export type LedgerTotals = { total: string; balance: string };
/** A whole ledger, captured when its screen opened. */
export type CapturedLedger = { rows: LedgerRow[]; totals: LedgerTotals };

/** Where the ledger shows: the stage-won screen supplies it as a scheduler service. */
export type LedgerSink = {
  /** Add one row and play its cue. */
  row(row: LedgerRow): void;
  /** Show the totals and offer the next choice. Called once per showing. */
  finish(totals: LedgerTotals): void;
  /** Show every row and the totals at once, silently, then offer the next choice. */
  summarise(ledger: CapturedLedger): void;
};
export type RewardLedgerServices = { rewardLedger: LedgerSink };

/** Ledger timing, in game-time units (1/15 s). */
export type LedgerTiming = {
  /** Before the first row, between rows and before the totals: 3.75 units is the 0.25 s it has always had. */
  rowStep: number;
};
export const ledgerTiming: LedgerTiming = { rowStep: 3.75 };

const sinkOf = (services: unknown) => (services as RewardLedgerServices).rewardLedger;

visualHandlers.register("ledger.row", (payload, context) => {
  sinkOf(context.services).row(payload as LedgerRow);
  return "done";
});

visualHandlers.register("ledger.finish", (payload, context) => {
  sinkOf(context.services).finish(payload as LedgerTotals);
  return "done";
});

visualFallbacks.register("ledger.summary", ({ services, payload }) =>
  sinkOf(services).summarise(payload as CapturedLedger),
);

/** The reward as plain data, each row written by its own registered presentation. */
export function captureLedger(reward: StageReward): CapturedLedger {
  return {
    rows: reward.entries.map((entry) => {
      const presentation = rewardPresentations.get(entry.presentation);
      return { label: entry.label, value: presentation.value(entry), cue: presentation.cue };
    }),
    totals: {
      total: `+${reward.balance - reward.balanceBefore}`,
      balance: String(reward.balance),
    },
  };
}

/**
 * Count the ledger in: its rows a step apart from now, then the finish a step after the last.
 * With `reduced` (reduced motion) every row and the finish are due at once, through the same
 * events. Returns the scope, for closing the screen to cancel; null when it couldn't be admitted
 * and the ledger was summarised at once instead.
 */
export function presentLedger(
  scheduler: Pick<VisualScheduler, "nowMs" | "createScope" | "scheduleBatch" | "seal" | "cancel">,
  sink: LedgerSink,
  ledger: CapturedLedger,
  options: { reduced: boolean; timing?: LedgerTiming },
): ScopeHandle | null {
  const step = options.reduced ? 0 : (options.timing ?? ledgerTiming).rowStep;
  const at = scheduler.nowMs / unitMs;
  const scope = scheduler.createScope(null, {
    fallback: "ledger.summary",
    fallbackPayload: ledger,
  });
  const admitted = scheduler.scheduleBatch(scope, [
    ...ledger.rows.map((row, index) => ({
      handler: "ledger.row",
      payload: row,
      dueUnits: at + (index + 1) * step,
    })),
    {
      handler: "ledger.finish",
      payload: ledger.totals,
      dueUnits: at + (ledger.rows.length + 1) * step,
    },
  ]);
  if (!admitted.accepted) {
    scheduler.cancel(scope);
    sink.summarise(ledger);
    return null;
  }
  scheduler.seal(scope);
  return scope;
}
