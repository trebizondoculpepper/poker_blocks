/**
 * DevManualBlockDestroyer (testing only): while a scene composing it is active, a
 * double-click on a table block asks the rules to destroy that block with the configured
 * cause. Whether it may be destroyed is the block's own destructible trait; a refusal is
 * the board service's to present. Dev traits are game features meant only for testing.
 */
import type { SceneTraitBehaviour } from "../scenes";
import type { DestroyCause } from "../traits/destructible";

/** What this trait needs from the table: which block is under a point, and destruction. */
export type BlockDestroyerBoard = {
  blockAt(clientX: number, clientY: number): string | undefined;
  /** Destroy the block if its traits allow the cause; false (and feedback) when refused. */
  destroy(blockId: string, cause: DestroyCause): boolean;
};

export type DevManualBlockDestroyerConfig = { cause: DestroyCause };

/** Input this trait reacts to, by event type; any other event passes through. */
const handlers: Record<
  string,
  (board: BlockDestroyerBoard, config: DevManualBlockDestroyerConfig, event: MouseEvent) => boolean
> = {
  dblclick(board, { cause }, event) {
    const blockId = board.blockAt(event.clientX, event.clientY);
    return [blockId ?? []].flat().some((id) => {
      board.destroy(id, cause);
      return true;
    });
  },
};

export function devManualBlockDestroyer<
  Context extends { services: { board: BlockDestroyerBoard } },
>(): SceneTraitBehaviour<Context, DevManualBlockDestroyerConfig> {
  return {
    handles(context, config, event) {
      const handle = Object.hasOwn(handlers, (event as Event).type)
        ? handlers[(event as Event).type]
        : undefined;
      return handle?.(context.services.board, config, event as MouseEvent) ?? false;
    },
  };
}
