/**
 * destructionExits (#1173; doc/triggered-presentation.md, "Victim exit and survival feedback are
 * separate capabilities"): a presentation controller trait that plays each authoritatively removed
 * table block's exit. The model has already removed the block; this only shows it going.
 *
 * - **Committed facts only.** It consumes the configured removal facts (`block.removed`) as each
 *   action commits: never a missing block inferred by comparing state, and never collection,
 *   unwrapping, reset or a refused destruction, which are other facts.
 * - **Captured, detached visual.** The field hands the victim's cube over (`detach`): from then on
 *   it is no gameplay entity, never hit-tested, and the exit owns it until it releases it, once.
 *   It can't rejoin the table or satisfy a later lookup in its cell.
 * - **Its own recipe.** The exit is the victim's captured appearance's `exit`, or its assembly's
 *   default (`resolvedExit`), run by the one shared exit presenter on the shared scheduler. A look
 *   with neither is a coverage diagnostic: the block simply goes, with no invented breakup.
 * - **Lifecycle.** Leaving the scene ends every exit it started; later input stays available
 *   throughout, since nothing here holds the model or input.
 *
 * Sounds are the committed facts' own (`committedEventSounds`); this plays none.
 */
import type { CardBlock } from "../cards";
import { Registry } from "../core/registry";
import type { EventEnvelope } from "../lifecycle/action";
import { getMaterialDefinition, materialOf, type MaterialDefinition } from "../materials";
import type { RenderedBlock } from "../rendered-blocks";
import type { SceneTraitBehaviour } from "../scenes";
import { containedParts } from "../visual/contained";
import { resolvedExit } from "../visual/exit-defaults";
import type {
  ExitPresenter,
  ExitSequence,
  ExitSnapshot,
  ExitVisual,
} from "../visual/exit-presentation";
import { factProducer, type PlacementPhase } from "../placement-phase";
import { phaseProducers } from "../visual-events/action-phases";
import { unitMs, visualHandlers, type EventDescription } from "../visual-events/scheduler";

/**
 * Victims' exits belong to their action's post-scoring presentation (#1315 review;
 * doc/triggered-presentation.md: finite victim scopes are the committed action's), so its outcome
 * waits for them. Reserved only while the controller is mounted (composed on enter).
 */
export const destructionExitsProducer = "destructionExits";
phaseProducers.register(
  destructionExitsProducer,
  factProducer({ fact: "block.removed", slot: "postScoring" }),
);

/** One action's victims' exits, started together when its post-scoring phase opens. */
visualHandlers.register("destruction.exits", (payload, context) => {
  for (const work of (payload as { exits: readonly EventDescription[] }).exits) {
    const admitted = context.schedule({ ...work, dueUnits: context.scheduledAtMs / unitMs });
    if (!admitted.accepted) console.warn(`a victim's exit was not admitted: ${admitted.reason}`);
  }
  return "done";
});

export type DestructionExitsConfig = Record<never, never>;

/**
 * Committed facts that authoritatively remove a block, by the fact they are: each names the block
 * removed, so the controller dispatches without asking what happened. Collection, unwrapping and
 * reset are other facts and register nothing here.
 */
export const removalFacts = new Registry<(payload: unknown) => string | null>("removal fact");
removalFacts.register(
  "block.removed",
  (payload) => (payload as { blockId?: string }).blockId ?? null,
);

/** What the trait needs: committed facts, the table to detach from, and the exit presenter. */
export type DestructionExitServices = {
  run: { onCommitted(listener: (facts: readonly EventEnvelope[]) => void): () => void };
  field: {
    detach(blockId: string): { rendered: RenderedBlock; release(): void } | null;
  };
  exits: Pick<ExitPresenter, "start" | "prepare" | "dispose">;
  /** The committed action's phase record, to bind its victims' exits to (#1315 review). */
  actionPhase: Pick<PlacementPhase, "latest" | "contributionFor">;
  /** Compose this controller's producer into the action phases while it is mounted. */
  composeProducer(producer: string): () => void;
  /** Where a captured block's definition comes from (default: the material registry). */
  definitionOf?(block: CardBlock): MaterialDefinition;
  /** Where a missing recipe is reported (default: the console). */
  diagnose?(message: string): void;
};

export function destructionExits<
  Context extends { services: DestructionExitServices },
>(): SceneTraitBehaviour<Context, DestructionExitsConfig> {
  let stop: (() => void) | null = null;
  let exits: DestructionExitServices["exits"] | null = null;
  let uncompose: (() => void) | null = null;
  return {
    enter({ services }) {
      stop?.();
      uncompose?.();
      exits = services.exits;
      uncompose = services.composeProducer(destructionExitsProducer);
      const definitionOf = (block: CardBlock) =>
        services.definitionOf?.(block) ?? getMaterialDefinition(materialOf(block));
      const diagnose = (message: string) =>
        services.diagnose ? services.diagnose(message) : console.warn(message);
      stop = services.run.onCommitted((committed) => {
        const victims: { snapshot: ExitSnapshot; visual: ExitVisual; sequence: ExitSequence }[] =
          [];
        for (const { type, payload } of committed) {
          if (!removalFacts.has(type)) continue;
          const blockId = removalFacts.get(type)(payload);
          if (!blockId) continue;
          // Not on the table (a hand card, one already gone): nothing of it to show.
          const detached = services.field.detach(blockId);
          if (!detached) continue;
          const { rendered } = detached;
          const release = () => detached.release();
          const definition = definitionOf(rendered.block);
          const sequence = resolvedExit(definition.appearance);
          if (!sequence) {
            diagnose(`no exit for ${definition.id}: ${blockId} leaves without one`);
            rendered.cube.removeFromParent();
            release();
            continue;
          }
          const { cube } = rendered;
          const parts = containedParts(cube);
          victims.push({
            snapshot: {
              blockId,
              ...(rendered.cell ? { cell: { ...rendered.cell } } : {}),
              material: definition.id,
            },
            visual: {
              root: cube,
              shell: [cube, ...parts.shell],
              contents: parts.contents,
              release,
            },
            sequence,
          });
        }
        // This action's reservation, if it has one (its record committed just before this).
        const key = services.actionPhase.latest;
        const contribution =
          key && services.actionPhase.contributionFor(key, destructionExitsProducer);
        if (!contribution) {
          // No action record to join (none composed, or it couldn't be recorded): each plays now.
          for (const { snapshot, visual, sequence } of victims)
            services.exits.start(snapshot, visual, sequence);
          return;
        }
        if (!victims.length) {
          contribution.settleEmpty();
          return;
        }
        const prepared = victims.map(({ snapshot, visual, sequence }) =>
          services.exits.prepare(snapshot, visual, sequence),
        );
        const abandon = () => prepared.forEach((each) => each.abandon());
        if (
          !contribution.bind({
            handler: "destruction.exits",
            payload: { exits: prepared.map(({ work }) => work) },
            dueUnits: 0,
          })
        )
          abandon();
        // Cancelled or failed before the exits started: their blocks still go, released once.
        else contribution.observe(abandon);
      });
    },
    exit() {
      stop?.();
      stop = null;
      uncompose?.();
      uncompose = null;
      // Every exit this scene started ends with it, releasing its block.
      exits?.dispose();
      exits = null;
    },
  };
}
