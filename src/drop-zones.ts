/**
 * Drop zones (#273, epic #271): places carried things can be dropped, each owning its own
 * decision. A zone is composed into a scene by the `canDragTo` trait, which enables it while the
 * scene shows. While something is carried, the router asks the enabled zones in priority order
 * (highest first) and the first to answer claims the point:
 *
 * - `accept`: it would take the carried things here; on release it takes them, committing to
 *   the model at once (#272, model first);
 * - `refuse`: the point is its, but it won't take them (the bin with no discards left); the
 *   drop is refused there;
 * - `null`: not here; the next zone is asked.
 *
 * The router never names a zone or asks what one is. Zone kinds are a registry keyed by name;
 * a scene's `canDragTo` data names the ones it allows and their priority.
 */
import type { RenderedBlock } from "./rendered-blocks";

export type DropVerdict = "accept" | "refuse";

export type DropZone = {
  /** How this zone would answer the carried blocks at a point, or null if it isn't there. */
  verdictAt(
    carried: readonly RenderedBlock[],
    clientX: number,
    clientY: number,
  ): DropVerdict | null;
  /** Show how it would answer while the carried blocks are over it, or clear that with null. */
  preview(verdict: DropVerdict | null): void;
  /** Take the carried blocks; true when the rules accept them. */
  deliver(carried: readonly RenderedBlock[]): boolean;
  /** The carried blocks were let go here while it refused them. */
  refuse(): void;
  /** Words for the action-history trace. */
  describe(verdict: DropVerdict): string;
};

/** One zone a scene allows, from its `canDragTo` data. */
export type DropZoneConfig = { zone: string; priority: number };

/** A point a zone has claimed during a drag. */
export type DropClaim = { name: string; zone: DropZone; verdict: DropVerdict };

export type DropZoneRouter = {
  /** Allow a zone while a scene shows; returns a function that disallows it again. */
  enable(config: DropZoneConfig): () => void;
  /** The first enabled zone, by priority, with an answer at this point. */
  claimAt(carried: readonly RenderedBlock[], clientX: number, clientY: number): DropClaim | null;
  /** Show this claim's preview on its zone and clear every other zone's. */
  preview(claim: DropClaim | null): void;
};

export function createDropZoneRouter(kinds: { get(name: string): DropZone }): DropZoneRouter {
  /** Enabled zones; a zone enabled by two scenes stays until both disable it. */
  const enabled: (DropZoneConfig & { zone: string })[] = [];
  const ordered = () => [...enabled].sort((a, b) => b.priority - a.priority);
  return {
    enable(config) {
      kinds.get(config.zone);
      const entry = { ...config };
      enabled.push(entry);
      return () => {
        const at = enabled.indexOf(entry);
        if (at >= 0) enabled.splice(at, 1);
        kinds.get(config.zone).preview(null);
      };
    },
    claimAt(carried, clientX, clientY) {
      for (const { zone: name } of ordered()) {
        const zone = kinds.get(name);
        const verdict = zone.verdictAt(carried, clientX, clientY);
        if (verdict) return { name, zone, verdict };
      }
      return null;
    },
    preview(claim) {
      for (const name of new Set(enabled.map(({ zone }) => zone))) {
        const zone = kinds.get(name);
        zone.preview(claim?.zone === zone ? claim.verdict : null);
      }
    },
  };
}
