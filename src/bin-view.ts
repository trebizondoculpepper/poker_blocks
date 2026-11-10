/**
 * The bin (#278): the shared lower-screen target that reads Discard in play and Sell in the shop
 * or while a passive is carried. It is shown while any scene composing `discardBin` or `sellBin`
 * is on the stack. This is presentation only: what a drop on it does belongs to the drop target
 * and drag sources that use it (the `discard` target, the rack's sell drop).
 */
export type BinView = {
  readonly element: HTMLElement;
  /** A scene composing `discardBin` came to the front, or left (#183). */
  discardBinEntered(entered: boolean): void;
  /** A scene composing `sellBin` came to the front, or left: the bin reads Sell. */
  sellBinEntered(entered: boolean): void;
  /** A passive is (or no longer is) being carried: the bin reads Sell meanwhile. */
  carrying(selling: boolean): void;
  /** Whether the bin reads Sell right now (a click on it then never discards). */
  readonly selling: boolean;
};

export function createBinView(element: HTMLElement): BinView {
  let discardScenes = 0;
  let sellScenes = 0;
  let carried = false;
  const label = element.querySelector(".discard-label")!;
  function show(): void {
    element.hidden = discardScenes + sellScenes === 0;
    const sell = carried || sellScenes > 0;
    element.classList.toggle("is-sell", sell);
    element.setAttribute("aria-label", sell ? "Sell area" : "Discard area");
    label.textContent = sell ? "SELL" : "DISCARD";
    if (!carried) element.classList.remove("is-target", "is-refused");
  }
  return {
    element,
    discardBinEntered(entered) {
      discardScenes = Math.max(0, discardScenes + (entered ? 1 : -1));
      show();
    },
    sellBinEntered(entered) {
      sellScenes = Math.max(0, sellScenes + (entered ? 1 : -1));
      show();
    },
    carrying(selling) {
      carried = selling;
      show();
    },
    get selling() {
      return element.classList.contains("is-sell");
    },
  };
}
