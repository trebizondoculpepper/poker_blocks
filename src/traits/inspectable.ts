import { defineTrait } from "../core/trait";
import type { CardBlock } from "../cards";

export type InspectableTrait = {
  inspect(): string;
};

export function inspectable(description: string): InspectableTrait {
  return { inspect: () => description };
}

export function inspectBlock(block: CardBlock): string | null {
  return block.traits.inspectable?.inspect() ?? null;
}

/** Core-block adapter for the same inspectable capability used by cards. */
export const inspectableTrait = defineTrait({
  name: "inspectable",
  defaults: { description: "" },
  setup({ block, settings }) {
    const describe = () => block.emit("inspection", inspectable(settings.description).inspect());
    const stops = [
      block.on("input.enter", describe),
      block.on("input.press", describe),
      block.on("inspect.request", describe),
    ];
    return () => stops.forEach((stop) => stop());
  },
});
