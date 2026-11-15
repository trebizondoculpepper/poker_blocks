/**
 * The status panel's scene-facing service (#1378; doc/run-status.md, "Host, providers and
 * lifecycle"). The `deckView` trait keeps its navigation, Back dispatch and `pausesBelow` policy;
 * this is what the trait shows underneath, and it is the shared tab host.
 *
 * It offers the trait only the narrow capabilities it needs: show, hide, and ask whether it is
 * open (a stage's outcome waits for it, #175). Its tabs are built when it is shown, from the run as
 * it is then, which is what makes re-entry after a transformation correct.
 */
import { createStatusHost, type StatusTab } from "./status-host";

export type StatusView = {
  /** Show the panel over the current run, with Deck first; `opener` gets focus back on close. */
  show(opener?: HTMLElement | null): void;
  hide(): void;
  /** Showing: a stage's outcome waits until it closes (#175). */
  readonly isOpen: boolean;
  dispose(): void;
};

export function createStatusView(
  host: HTMLElement,
  options: {
    /** The tabs to show, built from the run as it is at this showing. */
    tabs(): StatusTab[];
    /** The player closed it: the opening trait decides what happens next (go back). */
    close(): void;
    diagnose?(message: string): void;
  },
): StatusView {
  const inner = createStatusHost(host, {
    close: () => options.close(),
    diagnose: options.diagnose,
  });
  return {
    show(opener = null) {
      inner.show(options.tabs(), 0, opener);
    },
    hide: () => inner.hide(),
    get isOpen() {
      return inner.isOpen;
    },
    dispose: () => inner.dispose(),
  };
}
