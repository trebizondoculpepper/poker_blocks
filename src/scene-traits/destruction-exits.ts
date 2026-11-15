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
import type { ExitPresenter } from "../visual/exit-presentation";

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
  exits: Pick<ExitPresenter, "start" | "dispose">;
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
  return {
    enter({ services }) {
      stop?.();
      exits = services.exits;
      const definitionOf = (block: CardBlock) =>
        services.definitionOf?.(block) ?? getMaterialDefinition(materialOf(block));
      const diagnose = (message: string) =>
        services.diagnose ? services.diagnose(message) : console.warn(message);
      stop = services.run.onCommitted((committed) => {
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
          services.exits.start(
            {
              blockId,
              ...(rendered.cell ? { cell: { ...rendered.cell } } : {}),
              material: definition.id,
            },
            { root: cube, shell: [cube, ...parts.shell], contents: parts.contents, release },
            sequence,
          );
        }
      });
    },
    exit() {
      stop?.();
      stop = null;
      // Every exit this scene started ends with it, releasing its block.
      exits?.dispose();
      exits = null;
    },
  };
}
