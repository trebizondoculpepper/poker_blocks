/**
 * How a released hand drag settles (#1204; doc/drop-settlement.md, "Ownership and protocol"):
 * the hand's adoption of source-settled drop outcomes, kept apart from the input wiring so its
 * protocol paths can be checked directly.
 *
 * - **The hand's settlement.** Each release gets a gesture-owned handle: a synchronous return of
 *   the whole carried group to the hand, which succeeds only while every block is still the
 *   hand's (none played, removed or disposed meanwhile), and closes once.
 * - **No hit, or a rejecting one,** returns the blocks as before: the denial cue for a drop the
 *   rules refuse (or with no plays left), the return cue on empty space.
 * - **An accepting target answers an outcome**: its own (`outcome`), or its boolean `drop`
 *   through the transitional compatibility adapter. It is dispatched with the hand's settlement:
 *   a transfer needs nothing more; a refusal keeps its denial cue and return; a requested return
 *   has already restored the hand, with no denial. A requested return that failed was reported
 *   once by the target's own owner, so the hand adds nothing.
 */
import type { SoundEffectId } from "./audio/sfx-registry";
import type { DropHit } from "./drag-drop";
import {
  booleanOutcome,
  createSettlementHandle,
  dispatchDropOutcome,
  type DropResult,
} from "./drop-outcomes";
import type { RenderedBlock } from "./rendered-blocks";

export type HandReleaseHost = {
  /** Whether this block is still the hand's to restore. */
  owns(block: RenderedBlock): boolean;
  putBack(blocks: readonly RenderedBlock[]): void;
  layout(): void;
  sfx(id: SoundEffectId): void;
  trace(event: string, detail: string): void;
  canPlay(): boolean;
};

export type HandRelease = {
  carried: readonly RenderedBlock[];
  /** The carried blocks in play order, as the target takes them. */
  ordered: readonly RenderedBlock[];
  hit: DropHit | null;
  /** False for a cancelled drag. */
  drop: boolean;
  /** This gesture's settlement generation. */
  generation: number;
};

/** What the trace says for each settled outcome. */
const traced: Record<DropResult, (target: string) => string> = {
  transferred: (target) => `dropped on ${target}`,
  returned: () => "returned",
  refused: () => "refused",
  settled: () => "refused",
};

/** Settle one released hand drag; answers how it settled ("returned" with no target). */
export function settleHandRelease(
  host: HandReleaseHost,
  { carried, ordered, hit, drop, generation }: HandRelease,
): DropResult {
  const blocks = carried.length;
  const count = `${blocks} block${blocks === 1 ? "" : "s"}${hit ? ` at ${hit.name}` : ""}`;
  let returnAsked = false;
  const settlement = createSettlementHandle(generation, () => {
    returnAsked = true;
    if (!carried.every((block) => host.owns(block))) return false;
    host.putBack(carried);
    host.layout();
    host.sfx("card.drag.return");
    return true;
  });
  if (hit?.verdict !== "accept") {
    settlement.close();
    const refused = drop && (hit !== null || !host.canPlay());
    host.trace(hit ? "refused" : "returned", count);
    host.sfx(refused ? "action.denied" : "card.drag.return");
    host.putBack(carried);
    host.layout();
    return refused ? "refused" : "returned";
  }
  const outcome = hit.target.outcome
    ? hit.target.outcome(ordered, generation)
    : booleanOutcome(hit.target.drop(ordered), generation);
  const result = dispatchDropOutcome(outcome, settlement);
  host.trace(traced[result](hit.name), count);
  settlement.close();
  // Only an ordinary refusal still needs the hand's own denial and return.
  if (result !== "refused" || returnAsked) return result;
  host.sfx("action.denied");
  host.putBack(carried);
  host.layout();
  return result;
}
