import "./passive-rack.css";
import { passiveDefinitions, type PassiveBlock } from "./passives";

/** A fixed screen-space rack; the block and its event behavior live in GameState. */
export function createPassiveRack(host: HTMLElement): {
  element: HTMLElement;
  render(rack: readonly PassiveBlock[]): void;
} {
  const element = document.createElement("aside");
  element.className = "passive-rack";
  element.setAttribute("aria-label", "Passive rack");
  element.innerHTML =
    '<span class="passive-rack-title">PASSIVES</span><div class="passive-rack-slots"></div>';
  host.append(element);
  const slots = element.querySelector<HTMLElement>(".passive-rack-slots")!;
  return {
    element,
    render(rack) {
      slots.replaceChildren();
      for (const block of rack) {
        const definition = passiveDefinitions.get(block.definitionId);
        const cube = document.createElement("div");
        cube.className = "passive-cube";
        cube.setAttribute("role", "img");
        cube.setAttribute("aria-label", block.traits.inspectable.inspect());
        cube.title = block.traits.inspectable.inspect();
        for (const face of ["front", "top", "side"] as const) {
          const side = document.createElement("span");
          side.className = `passive-cube-${face}`;
          side.textContent = definition.symbol;
          cube.append(side);
        }
        slots.append(cube);
      }
    },
  };
}
