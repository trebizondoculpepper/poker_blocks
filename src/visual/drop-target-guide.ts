/**
 * The drag target-guide controller (#922, part of #500; doc/presentation-contracts.md, "Laser
 * target-guide controller"). While a drag runs, it asks a registered guide provider which areas
 * this drag prefers and whether dropping would be refused now, and draws a laser guide over each
 * preferred area: the `accept` look (a rectangle) when the drop would succeed, the `refuse` look (a
 * red X) when it would be refused. Valid areas the drag doesn't prefer stay unmarked.
 *
 * It only presents. Acceptance stays with the drop targets and their verdicts; the controller
 * never recomputes rules, plays no sound, changes no model and keeps no timer. It follows the
 * drag lifecycle and clears at once on end or cancel (cancel covers lost capture), when a
 * preferred area disappears, and on dispose, which also frees its overlay, guides and observers.
 */
import { Registry } from "../core/registry";
import type { DragLifecycle } from "../drag-drop";
import { createDropGuide, type DropGuideConfig } from "./drop-guide";
import { createHudOverlay, overlayCentre } from "./hud-overlay";

/** What a guide asks about the current drag; provided by the drag's owner, never inferred. */
export type DropGuideProvider = {
  /** The areas this drag is guided to (its preferred targets); none for a drag it doesn't guide. */
  preferred(drag: DragLifecycle): readonly Element[];
  /** Why dropping it there would be refused now (the live verdict), or null when it would succeed. */
  refusal(drag: DragLifecycle): string | null;
};

/** Guide providers by name: a scene's `dropTargetGuide` configuration names one. */
export const dropGuideProviders = new Registry<DropGuideProvider>("drop guide provider");

export type DropTargetGuideConfig = {
  /** The registered provider that says what to guide. */
  provider: string;
  /** The look over a preferred area the drop would succeed on. */
  accept: DropGuideConfig;
  /** The look over a preferred area the drop would be refused on. */
  refuse: DropGuideConfig;
};

/** What the controller needs from its surroundings, so it never reaches for globals. */
export type DropTargetGuideHost = {
  /** The element the overlay canvas covers (the scene's HUD overlay layer). */
  element: HTMLElement;
  observeDrag(listener: (event: DragLifecycle) => void): () => void;
  providers?: Pick<Registry<DropGuideProvider>, "get">;
  /** Overlay factory; tests pass a fake. */
  overlay?: typeof createHudOverlay;
};

type Shown = { area: Element; refused: boolean; guide: ReturnType<typeof createDropGuide> };

export function createDropTargetGuide(config: DropTargetGuideConfig, host: DropTargetGuideHost) {
  const provider = (host.providers ?? dropGuideProviders).get(config.provider);
  const overlay = (host.overlay ?? createHudOverlay)(host.element);
  let shown: Shown[] = [];
  let unobserve: (() => void)[] = [];
  let drag: DragLifecycle | null = null;

  const clear = () => {
    for (const { guide } of shown) guide.dispose();
    shown = [];
    unobserve.forEach((stop) => stop());
    unobserve = [];
  };
  /** Fit each guide to its area's live rectangle; an area that left the page ends the guide. */
  const place = () => {
    if (shown.some(({ area }) => !area.isConnected)) return refresh();
    for (const { area, guide } of shown) {
      const rect = overlay.rectOf(area);
      guide.setBounds(rect.width, rect.height);
      const centre = overlayCentre(rect);
      guide.object.position.set(centre.x, centre.y, 0);
    }
  };
  /** Ask the provider again and rebuild the guides only when what they show has changed. */
  function refresh(): void {
    const areas = drag ? provider.preferred(drag).filter((area) => area.isConnected) : [];
    const refused = drag !== null && provider.refusal(drag) !== null;
    const same =
      areas.length === shown.length &&
      areas.every((area, i) => shown[i]!.area === area && shown[i]!.refused === refused);
    if (!same) {
      clear();
      shown = areas.map((area) => {
        const guide = createDropGuide(refused ? config.refuse : config.accept);
        overlay.scene.add(guide.object);
        unobserve.push(overlay.observe(area));
        return { area, refused, guide };
      });
    }
    place();
  }

  const stopLayout = overlay.onLayout(place);
  const stopDrag = host.observeDrag((event) => {
    drag = event.live ? event : null;
    refresh();
  });

  return {
    /** Advance the beams and draw; called each frame by the owning trait. */
    frame(seconds: number, reducedMotion: boolean) {
      if (drag) refresh();
      for (const { guide } of shown) guide.update(seconds, reducedMotion);
      overlay.render();
    },
    /** How many guides show now, and which look each has (for tests and diagnostics). */
    showing(): readonly { area: Element; refused: boolean }[] {
      return shown.map(({ area, refused }) => ({ area, refused }));
    },
    dispose() {
      stopDrag();
      stopLayout();
      drag = null;
      clear();
      overlay.dispose();
    },
  };
}
export type DropTargetGuide = ReturnType<typeof createDropTargetGuide>;
