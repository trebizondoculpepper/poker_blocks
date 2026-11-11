import { defineTrait } from "../core/trait";
import type { CardBlock } from "../cards";
import { availability } from "./availability";

export type InspectableTrait = {
  inspect(): string;
};

export function inspectable(description: string): InspectableTrait {
  return { inspect: () => description };
}

export function inspectBlock(block: CardBlock): string | null {
  return block.traits.inspectable?.inspect() ?? null;
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
