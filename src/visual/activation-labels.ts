/**
 * Transient activation text (#918, part of #486; doc/presentation-contracts.md, "Resolved
 * activation results"). Shows an activation descriptor's captured text beside its source for
 * exactly the presentation interval the shared visual-event scheduler gives it, then removes it.
 *
 * - **Who owns what.** The scheduler owns start, end and cancellation: the registered
 *   `activationLabel` handler returns an effect that lasts `durationUnits` from its scheduled start
 *   and is removed on cancel or dispose. The label layer owns the DOM. Nothing here keeps a timer.
 * - **Anchors.** Where a label goes comes from a registered **anchor space**, named in the
 *   payload with an opaque anchor reference: it turns that reference into a live point in the
 *   layer's CSS pixels, or null when the source is gone (the label then ends at once). A rack, a
 *   field block or anything later registers its own space; nothing here knows which it is.
 * - **Placement** is a pure, deterministic function: each label is centred above its point,
 *   kept inside the layer (portrait or landscape) and, when it would overlap an earlier label,
 *   moved clear of it, in showing order.
 * - **Accessibility.** Labels are hidden from assistive technology; one polite live region
 *   announces each label's text once when it appears, never again as it moves.
 *
 * It reads no model state, draws no randomness and plays no sound (the pulse already does).
 */
import { Registry } from "../core/registry";
import { unitsToMs, type EffectHandle, visualHandlers } from "../visual-events/scheduler";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

/** Turns an opaque anchor reference into a live point getter (null once the source is gone). */
export type AnchorSpace = (anchor: unknown, services: unknown) => () => Point | null;
export const labelAnchorSpaces = new Registry<AnchorSpace>("label anchor space");

/** Space between a label and its anchor, and between stacked labels, in CSS pixels. */
export const labelGap = 6;

/**
 * Where each label goes, in showing order: centred above its anchor, inside `bounds`, and clear
 * of every earlier label (moved above it, or below the anchor when there is no room above).
 */
export function placeLabels(
  requests: readonly (Size & { anchor: Point })[],
  bounds: Size,
  gap = labelGap,
): Rect[] {
  const placed: Rect[] = [];
  const clampX = (x: number, width: number) =>
    Math.max(gap, Math.min(x, Math.max(gap, bounds.width - gap - width)));
  const clampY = (y: number, height: number) =>
    Math.max(gap, Math.min(y, Math.max(gap, bounds.height - gap - height)));
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap;
  for (const { anchor, width, height } of requests) {
    const x = clampX(anchor.x - width / 2, width);
    const fits = (y: number) =>
      y >= gap && y + height <= bounds.height - gap
        ? !placed.some((other) => overlaps({ x, y, width, height }, other))
        : false;
    // Candidate rows: just above the anchor, then above each earlier label, then below the
    // anchor and below each earlier label; the first that fits wins. Nothing fits: clamp.
    const above = [anchor.y - gap - height, ...placed.map((o) => o.y - gap - height)]
      .filter((y) => y <= anchor.y - gap - height)
      .sort((a, b) => b - a);
    const below = [anchor.y + gap, ...placed.map((o) => o.y + o.height + gap)]
      .filter((y) => y >= anchor.y + gap)
      .sort((a, b) => a - b);
    const y = [...above, ...below].find(fits) ?? clampY(anchor.y - gap - height, height);
    placed.push({ x, y, width, height });
  }
  return placed;
}

/** One shown label: re-place it from its anchor, or remove it. */
export type ShownLabel = { refresh(): boolean; remove(): void };

export type ActivationLabelLayer = {
  /** Show `text` (lines split on newlines) at a live anchor; announced once. */
  show(text: string, anchor: () => Point | null): ShownLabel;
  dispose(): void;
};

/** The DOM label layer, over `host`: pointer-transparent, one element per label. */
export function createActivationLabelLayer(host: HTMLElement): ActivationLabelLayer {
  const layer = document.createElement("div");
  layer.className = "activation-labels";
  const live = document.createElement("div");
  live.className = "activation-labels-live";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  host.append(layer, live);
  const labels: { element: HTMLElement; anchor: () => Point | null }[] = [];

  function layout(): void {
    const visible = labels.flatMap((label) => {
      const point = label.anchor();
      label.element.hidden = !point;
      return point ? [{ element: label.element, point }] : [];
    });
    const rects = placeLabels(
      visible.map(({ element, point }) => ({
        width: element.offsetWidth,
        height: element.offsetHeight,
        anchor: point,
      })),
      { width: host.clientWidth, height: host.clientHeight },
    );
    visible.forEach(({ element }, index) => {
      element.style.transform = `translate(${rects[index]!.x}px, ${rects[index]!.y}px)`;
    });
  }

  return {
    show(text, anchor) {
      const element = document.createElement("div");
      element.className = "activation-label";
      element.setAttribute("aria-hidden", "true");
      element.textContent = text;
      layer.append(element);
      const entry = { element, anchor };
      labels.push(entry);
      // Its own announcement entry, so labels appearing together are each announced (#918
      // review); it leaves with the label.
      const announcement = document.createElement("p");
      announcement.textContent = text.replace(/\n/g, ", ");
      live.append(announcement);
      layout();
      return {
        refresh() {
          if (!anchor()) return false;
          layout();
          return true;
        },
        remove() {
          const index = labels.indexOf(entry);
          if (index < 0) return;
          labels.splice(index, 1);
          element.remove();
          announcement.remove();
          layout();
        },
      };
    },
    dispose() {
      labels.splice(0).forEach(({ element }) => element.remove());
      layer.remove();
      live.remove();
    },
  };
}

/** What the `activationLabel` handler is given: captured text and where, for how long. */
export type ActivationLabelPayload = {
  text: string;
  /** A registered anchor space, and its opaque reference to the source. */
  space: string;
  anchor: unknown;
  /** The presentation interval, in game-time units: the pulse's own length. */
  durationUnits: number;
};

/** The services the handler reads: the layer to draw in. */
export type ActivationLabelServices = { activationLabels?: ActivationLabelLayer };

visualHandlers.register("activationLabel", (raw, context): "done" | EffectHandle => {
  const { text, space, anchor, durationUnits } = raw as ActivationLabelPayload;
  const layer = (context.services as ActivationLabelServices | undefined)?.activationLabels;
  // Nothing to draw in, nothing to say, or no such space: the event settles at once.
  if (!layer || !text || !labelAnchorSpaces.has(space)) return "done";
  const point = labelAnchorSpaces.get(space)(anchor, context.services);
  if (!point()) return "done";
  const endsAt = context.scheduledAtMs + unitsToMs(durationUnits);
  // Started late, after its interval already ended: nothing is shown or announced (#918 review).
  if (context.nowMs >= endsAt) return "done";
  const label = layer.show(text, point);
  return {
    update: (nowMs) => (nowMs >= endsAt || !label.refresh() ? "finished" : "running"),
    cancel: () => label.remove(),
    dispose: () => label.remove(),
  };
});
