/**
 * A developer room built only while it is shown (#1365). Each room draws with its own WebGL
 * renderer, and a page may hold only so many live WebGL contexts (about 16 in Chrome): past
 * that, the browser drops the oldest one, which is the table's, so the room and table vanish
 * behind a blank canvas. A room that is not shown should hold no context at all, so it is built
 * on its first `show` and disposed (its context released) on `hide`; showing it again builds it
 * afresh. It knows nothing about which room it wraps.
 */
export type ShownRoom<Config> = { show(config: Config): void; hide(): void; dispose(): void };

export function lazyRoom<Config, Room extends ShownRoom<Config>>(
  create: () => Room,
): ShownRoom<Config> {
  let room: Room | null = null;
  return {
    show(config) {
      room ??= create();
      room.show(config);
    },
    hide() {
      if (!room) return;
      room.hide();
      room.dispose();
      room = null;
    },
    dispose() {
      room?.dispose();
      room = null;
    },
  };
}
