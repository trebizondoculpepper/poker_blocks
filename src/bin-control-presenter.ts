/**
 * The shop Sell target as a 3D control block (#1078; doc/shop-control-blocks.md, "Three configured
 * controls" and "Preserve Buy and Sell ownership"): a steel cube with SELL and a dustbin motif,
 * placed in the shop's shared control group (one rendering host with Buy) over a slot inside the
 * bin, while a scene composing `sellBin` names this presenter. Presentation only: the bin element
 * stays the drop target, and sale/refusal belong to the drop owner. Discard is untouched.
 */
import type { ControlGroup } from "./block-menu/control-group";
import { binPresenters } from "./bin-view";
import { withMotif } from "./visual/motif-face-art";

/** Register the `controlBlock` bin presenter over the composed control group. */
export function registerBinControlPresenter(group: Pick<ControlGroup, "place">): void {
  binPresenters.register("controlBlock", {
    mount(element) {
      const slot = document.createElement("div");
      slot.className = "bin-control-cube";
      element.prepend(slot);
      const control = group.place(slot, {
        id: "sell",
        label: "SELL",
        description: "Drop an installed item here to sell it.",
        cube: { material: "steel", artwork: withMotif({ handler: "dustbin" }), precession: {} },
      });
      return {
        setCovered: (covered) => control.setHidden(covered),
        dispose() {
          control.remove();
          slot.remove();
        },
      };
    },
  });
}
