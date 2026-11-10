/**
 * The selection badge (#305): "N selected" over the hand while two or more hand blocks are
 * selected, so a drag that carries the whole selection is never a surprise. It shows only while a
 * scene composing `handView` is on the stack: leaving to the title hides it with the hand.
 */
export type SelectionBadge = {
  /** How many hand blocks are selected now. */
  count(selected: number): void;
  /** A scene composing `handView` came to the front, or left. */
  handEntered(entered: boolean): void;
  dispose(): void;
};

export function createSelectionBadge(host: HTMLElement): SelectionBadge {
  const element = document.createElement("div");
  element.className = "selection-badge";
  element.hidden = true;
  host.append(element);
  let handScenes = 0;
  let selected = 0;
  const show = () => {
    element.textContent = `${selected} selected`;
    element.hidden = handScenes === 0 || selected < 2;
  };
  return {
    count(next) {
      selected = next;
      show();
    },
    handEntered(entered) {
      handScenes = Math.max(0, handScenes + (entered ? 1 : -1));
      show();
    },
    dispose: () => element.remove(),
  };
}
