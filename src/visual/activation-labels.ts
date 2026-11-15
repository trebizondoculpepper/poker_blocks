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
import {
  canvasTextMeasure,
  createFittedTextLayout,
  fittedTextProvider,
  invalidateWhenFontsReady,
  narrationTextStyle,
  renderFittedText,
  type TextMeasure,
} from "./fitted-text";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

/**
 * A live anchor: a point, and the source's projected bounds when its provider can supply them
 * (#1157; doc/presentation-contracts.md, "Placement capability: over the actual item"). All in the
 * layer's CSS pixels.
 */
export type AnchorPoint = Point & { bounds?: Rect };

/** Turns an opaque anchor reference into a live anchor getter (null once the source is gone). */
export type AnchorSpace = (anchor: unknown, services: unknown) => () => AnchorPoint | null;
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

/** What a placement mode lays out with: the shared fitted-text layout of its layer. */
export type LabelFitting = {
  layout: ReturnType<typeof createFittedTextLayout>;
};

/**
 * A registered placement mode, chosen by reference from the label's composition: how a label's
 * text is laid into its element, and where the labels go. Never chosen by source or owner.
 */
export type LabelPlacement = {
  /** Lay `text` into `element` for this anchor; the element's resulting size follows. */
  render(
    element: HTMLElement,
    text: string,
    anchor: AnchorPoint,
    viewport: Size,
    fit: LabelFitting,
  ): void;
  /** Where each label goes, in showing order. */
  place(requests: readonly (Size & { anchor: AnchorPoint })[], viewport: Size): Rect[];
};
export const labelPlacements = new Registry<LabelPlacement>("label placement");

/** The existing caption: plain text, above its point and clear of earlier captions. */
labelPlacements.register("caption", {
  render(element, text) {
    if (element.textContent !== text) element.textContent = text;
  },
  place: (requests, viewport) => placeLabels(requests, viewport),
});

/**
 * The over-item text budget (#1157): up to 1.6 times the item's width, at least 96 CSS px when
 * space allows, at most 240 and never wider than the viewport; as tall as the narration profile's
 * largest block, within the viewport.
 */
export function overBoundsBudget(bounds: Size, viewport: Size): Size {
  const width = Math.min(viewport.width, Math.min(240, Math.max(96, bounds.width * 1.6)));
  const tallest =
    narrationTextStyle.maxLines * narrationTextStyle.maxPx * narrationTextStyle.lineHeight;
  return { width: Math.max(1, width), height: Math.max(1, Math.min(viewport.height, tallest)) };
}

/**
 * Centred over the source's projected bounds (or its point, from a point-only provider). Labels
 * never move above or below to avoid each other, and are never re-anchored at the edges: the
 * layer clips what falls outside it.
 */
labelPlacements.register("overBounds", {
  render(element, text, anchor, viewport, fit) {
    const budget = overBoundsBudget(anchor.bounds ?? { width: 0, height: 0 }, viewport);
    const fitted = fit.layout.layout({ text, style: narrationTextStyle, ...budget });
    renderFittedText(element, fitted, narrationTextStyle);
    element.classList.add("activation-label-fitted");
  },
  place: (requests) =>
    requests.map(({ anchor, width, height }) => {
      const centre = anchor.bounds
        ? {
            x: anchor.bounds.x + anchor.bounds.width / 2,
            y: anchor.bounds.y + anchor.bounds.height / 2,
          }
        : anchor;
      return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
    }),
});

/** One shown label: re-place it from its anchor, or remove it. */
export type ShownLabel = { refresh(): boolean; remove(): void };

export type ActivationLabelLayer = {
  /**
   * Show `text` (lines split on newlines) at a live anchor, laid out by a registered placement
   * (the caption by default); announced once, in full.
   */
  show(text: string, anchor: () => AnchorPoint | null, placement?: string): ShownLabel;
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
  type Shown = {
    element: HTMLElement;
    text: string;
    anchor: () => AnchorPoint | null;
    placement: string;
  };
  const labels: Shown[] = [];
  // One measured layout for every fitted label in the layer, cached by text and budget.
  const context = document.createElement("canvas").getContext("2d");
  const measure: TextMeasure = context
    ? canvasTextMeasure(context, getComputedStyle(host).fontFamily || "sans-serif")
    : (text, px) => text.length * px * 0.55;
  const fit: LabelFitting = { layout: createFittedTextLayout(fittedTextProvider, measure) };

  function layout(): void {
    const viewport = { width: host.clientWidth, height: host.clientHeight };
    const visible = labels.flatMap((label) => {
      const anchor = label.anchor();
      label.element.hidden = !anchor;
      return anchor ? [{ label, anchor }] : [];
    });
    // Each placement lays out its own labels, in showing order.
    for (const name of new Set(visible.map(({ label }) => label.placement))) {
      const mine = visible.filter(({ label }) => label.placement === name);
      const placement = labelPlacements.get(name);
      for (const { label, anchor } of mine)
        placement.render(label.element, label.text, anchor, viewport, fit);
      const rects = placement.place(
        mine.map(({ label, anchor }) => ({
          width: label.element.offsetWidth,
          height: label.element.offsetHeight,
          anchor,
        })),
        viewport,
      );
      mine.forEach(({ label }, index) => {
        label.element.style.transform = `translate(${rects[index]!.x}px, ${rects[index]!.y}px)`;
      });
    }
  }
  // Fonts becoming ready change the measurements: lay out again, once.
  const stopFonts = invalidateWhenFontsReady(document.fonts, fit.layout, layout);

  return {
    show(text, anchor, placement = "caption") {
      const element = document.createElement("div");
      element.className = "activation-label";
      element.setAttribute("aria-hidden", "true");
      layer.append(element);
      const entry: Shown = { element, text, anchor, placement };
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
      stopFonts();
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
  /** A registered label placement (#1157); the caption when absent. */
  placement?: string;
};

/** The services the handler reads: the layer to draw in. */
export type ActivationLabelServices = { activationLabels?: ActivationLabelLayer };

visualHandlers.register("activationLabel", (raw, context): "done" | EffectHandle => {
  const {
    text,
    space,
    anchor,
    durationUnits,
    placement = "caption",
  } = raw as ActivationLabelPayload;
  const layer = (context.services as ActivationLabelServices | undefined)?.activationLabels;
  // Nothing to draw in, nothing to say, or no such space or placement: it settles at once.
  if (!layer || !text || !labelAnchorSpaces.has(space) || !labelPlacements.has(placement))
    return "done";
  const point = labelAnchorSpaces.get(space)(anchor, context.services);
  if (!point()) return "done";
  const endsAt = context.scheduledAtMs + unitsToMs(durationUnits);
  // Started late, after its interval already ended: nothing is shown or announced (#918 review).
  if (context.nowMs >= endsAt) return "done";
  const label = layer.show(text, point, placement);
  return {
    update: (nowMs) => (nowMs >= endsAt || !label.refresh() ? "finished" : "running"),
    cancel: () => label.remove(),
    dispose: () => label.remove(),
  };
});
