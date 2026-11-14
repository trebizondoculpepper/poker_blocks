import { defineTrait } from "../core/trait";
import type { CardBlock } from "../cards";
import { availability } from "./availability";
import { Registry } from "../core/registry";

export type InspectableTrait = {
  inspect(): string;
};

export function inspectable(description: string): InspectableTrait {
  return { inspect: () => description };
}

/**
 * Live description providers (#751): each adds its own lines from the card's current state after
 * the card's ordinary description, in registration order. Hosts never ask which apply.
 */
export const inspectionProviders = new Registry<(block: CardBlock) => readonly string[]>(
  "inspection provider",
);

/** A card's full description: its own, then every provider's lines. Null when it has none. */
export function inspectBlock(block: CardBlock): string | null {
  const own = block.traits.inspectable?.inspect();
  if (own === undefined) return null;
  const lines = inspectionProviders.names().flatMap((name) => inspectionProviders.get(name)(block));
  return [own, ...lines].join("\n");
}

/**
 * Core-block adapter for the same inspectable capability used by cards (#462): hovering, keyboard
 * focus or a long-press (`inspect.request`) shows what choosing the block does, and when it is
 * unavailable, why. Availability comes live from `input.enabled` (src/traits/availability.ts), and
 * while the block is being inspected a change of availability re-describes it, so the reason is
 * never stale. A plain press never inspects: on touch it is the tap that activates.
 */
export const inspectableTrait = defineTrait({
  name: "inspectable",
  defaults: { description: "", disabledReason: "" },
  setup({ block, settings }) {
    let enabled = true;
    let reason = "";
    let inspecting = false;
    const text = () => {
      const why = reason || settings.disabledReason;
      return enabled || !why ? settings.description : `${settings.description} Unavailable: ${why}`;
    };
    const describe = () => {
      inspecting = true;
      block.emit("inspection", inspectable(text()).inspect());
    };
    const stops = [
      block.on("input.enter", describe),
      block.on("input.focus", describe),
      block.on("inspect.request", describe),
      block.on("input.leave", () => void (inspecting = false)),
      block.on("input.blur", () => void (inspecting = false)),
      // A cancelled gesture (the pointer left the stage) ends inspection too. A long-press
      // cancels its press before it asks for inspection, so that still describes.
      block.on("input.cancel", () => void (inspecting = false)),
      block.on("input.enabled", (payload) => {
        const now = availability(payload);
        enabled = now.enabled;
        reason = now.reason ?? "";
        if (inspecting) describe();
      }),
    ];
    return () => stops.forEach((stop) => stop());
  },
});
