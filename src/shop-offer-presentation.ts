/**
 * Shop stock dancing and individual emphasis (#772, #774; doc/shop-stock-motion.md).
 *
 * Every mounted offer, whatever its kind, gets the same layered presentation:
 *
 *   root (layout/action: slot projection, entrance, drag, return, burn — owned by the shop view)
 *     └ dance  (bob and tilt from the shared dance floor)
 *         └ feedback (hover/focus/press emphasis, owned by `interactionFeedback`)
 *             └ the offer's model
 *
 * No two writers share an Object3D property. While the action owner reports the offer as busy
 * (entering, dragged, returning, burning), the inner layers rest smoothly rather than snapping.
 */
import * as THREE from "three";
import { playSfx } from "./audio/sfx";
import { Block } from "./core/block";
import { defineTrait } from "./core/trait";
import type { DanceFloor } from "./dance/dance-floor";
import { interactionFeedback, type PresentationMount } from "./traits/interaction-feedback";
import type { InteractionState } from "./traits/menu-action";

export type ShopOfferPresentationConfig = {
  /** Registered `danceCycles` name the stock follows. */
  cycle: string;
  /** Beats between successive offers' phases, by stable stock order. */
  phaseStep: number;
  /** Vertical bob, as a fraction of the offer's cube edge. */
  bob: number;
  /** Largest side-to-side tilt, in degrees. */
  tiltDegrees: number;
  /** How quickly the ambient layers rest and resume (per second). */
  response: number;
  /** Settings for the shared hover/focus/press feedback. */
  feedback: Partial<typeof interactionFeedback.defaults>;
};

export const shopOfferPresentationDefaults: ShopOfferPresentationConfig = {
  cycle: "bar",
  phaseStep: 0.25,
  bob: 0.03,
  tiltDegrees: 4,
  response: 8,
  feedback: { hoverScale: 1.04, hoverLift: 0 },
};

/**
 * A generic interaction-state provider: normalises hover, focus and press into
 * `interaction.state` without attaching an action. `available` comes from the action owner's
 * presentation envelope (resting while busy); purchase availability is never decided here.
 */
export const interactionStateProvider = defineTrait({
  name: "interactionStateProvider",
  defaults: { hoverSfx: true },
  setup({ block, settings }) {
    let pointer = false;
    let focus = false;
    let pressed = false;
    let available = true;
    let announced = false;
    const publish = () => {
      const hovered = pointer || focus;
      if (hovered && available && !announced && settings.hoverSfx) playSfx("ui.hover");
      announced = hovered;
      block.emit("interaction.state", {
        enabled: available,
        hovered,
        pressed,
      } satisfies InteractionState);
    };
    const on = (type: string, change: (value: unknown) => void) =>
      block.on(type, (value) => {
        change(value);
        publish();
      });
    const stops = [
      on("input.enter", () => (pointer = true)),
      on("input.leave", () => ((pointer = false), (pressed = false))),
      on("input.focus", () => (focus = true)),
      on("input.blur", () => (focus = false)),
      on("input.press", () => (pressed = true)),
      on("input.release", () => (pressed = false)),
      on("presentation.available", (value) => (available = value === true)),
    ];
    return () => stops.forEach((stop) => stop());
  },
});

export type OfferPresentation = {
  /** The layout/action root the shop view positions. */
  readonly root: THREE.Group;
  readonly block: Block;
  /** Advance the ambient layers; `busy` while an action owns the offer's pose. */
  update(dt: number, busy: boolean, reducedMotion: boolean): void;
  dispose(): void;
};

export function createOfferPresentation(
  model: THREE.Object3D,
  options: {
    id: string;
    order: number;
    floor: Pick<DanceFloor, "join">;
    config?: Partial<ShopOfferPresentationConfig>;
  },
): OfferPresentation {
  const config = { ...shopOfferPresentationDefaults, ...options.config };
  const root = new THREE.Group();
  const dance = new THREE.Group();
  const feedback = new THREE.Group();
  root.add(dance);
  dance.add(feedback);
  feedback.add(model);

  const block = new Block(options.id);
  block.add(interactionStateProvider);
  block.add(interactionFeedback, config.feedback);
  const materials = new Set<THREE.Material>();
  model.traverse((child) => {
    for (const material of [(child as THREE.Mesh).material ?? []].flat()) materials.add(material);
  });
  block.emit("presentation.mount", {
    object: feedback,
    materials: [...materials],
  } satisfies PresentationMount);

  let phase = 0;
  let energy = 0;
  const leave = options.floor.join({
    cycle: config.cycle,
    offset: options.order * config.phaseStep,
    dance(move) {
      phase = move.phase;
      energy = move.energy;
    },
  });

  let weight = 0;
  let available: boolean | undefined;
  const feedbackSettings = block.settingsOf(interactionFeedback)!;
  const tilt = THREE.MathUtils.degToRad(config.tiltDegrees);
  return {
    root,
    block,
    update(dt, busy, reducedMotion) {
      if (available !== !busy) {
        available = !busy;
        block.emit("presentation.available", available);
      }
      feedbackSettings.reducedMotion = reducedMotion;
      const target = busy || reducedMotion ? 0 : 1;
      weight = reducedMotion
        ? 0
        : weight + (target - weight) * (1 - Math.exp(-config.response * Math.max(0, dt)));
      const amount = energy * weight;
      const angle = phase * Math.PI * 2;
      dance.position.y = Math.sin(angle) * config.bob * amount;
      dance.rotation.z = Math.sin(angle + Math.PI / 2) * tilt * amount;
      block.update(dt);
    },
    dispose() {
      leave();
      block.dispose();
      feedback.remove(model);
    },
  };
}
