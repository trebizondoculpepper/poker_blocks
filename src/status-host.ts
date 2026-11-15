/**
 * The shared tabbed status host (#1378; doc/run-status.md, "Host, providers and lifecycle").
 *
 * One read-only overlay showing whatever tabs its composition hands it, with accessible tablist
 * semantics, focus and close lifecycle. It is the shell only: it asks no provider what state the
 * run is in, names no tab, card kind or scene, and renders whatever plain content a tab gives it.
 *
 * - **Configured tabs, in order.** `show` receives the tabs (a caption and a provider each) and the
 *   initial selection. A provider's `content()` is asked once per showing and again whenever its
 *   `watch` reports a change, so the panel is never stale and never polled.
 * - **Narrow invalidation.** `watch` is the provider's own owner subscription; the host holds its
 *   release and calls it on hide and on cover, so nothing from a closed showing draws into a later
 *   one. The host has no frame loop and reads no run state of its own.
 * - **Local UI state.** The selection lives in this overlay alone: it is not saved and not part of
 *   the run, so each showing starts at the configured tab.
 * - **Accessible.** The row is a `tablist` of `tab`s, each controlling its `tabpanel`. Arrow keys,
 *   Home and End move focus, Enter or Space selects, Escape closes. Only the selected tab is on the
 *   Tab path, and the panel is focusable, so a keyboard user reaches the content and the row.
 * - **Close returns.** The element that opened the panel gets focus back, so the bottom-right
 *   counter keeps its place.
 * - **Missing provider.** A provider that throws shows its own fallback line rather than taking the
 *   panel down: the other tabs must keep working.
 */
import { isPanelCloseKey, isTabActivationKey, tabFocusAfter } from "./tablist";

/**
 * What a tab shows. `title` is the panel's own heading; `rows` are read-only entries, each with the
 * text it always shows and an optional longer inspection text.
 */
export type TabContent = {
  title: string;
  /** One line under the heading: what this tab lists, or its empty state. */
  summary: string;
  /** Its entries, in the order they are shown. */
  rows?: readonly TabRow[];
  /** What could not be described, and why: never a fabricated value. */
  unavailable?: string;
};

export type TabRow = {
  /** What the row always shows; never a substitute for the inspection text. */
  text: string;
  /** What focus, hover or tap reveals: the complete description the item shows in play. */
  inspect?: string;
  /** Anything the row stands for, so its owner can find it after a redraw. */
  ref?: string;
};

/** A tab's content, as the host sees it: plain data, no run, no mutation, nothing to decide. */
export type StatusProvider = {
  /** The tab's content now. */
  content(): TabContent;
  /**
   * Call `changed` when this tab's owning state changes; return the release. Omitted, the tab is
   * read once per showing (it has nothing that changes while the panel is open).
   */
  watch?(changed: () => void): () => void;
};

export type StatusTab = {
  /** The tab's caption in the row. */
  label: string;
  /** A stable id, shared by the tab and its panel for the accessible relationship. */
  id: string;
  provider: StatusProvider;
};

export type StatusHost = {
  /**
   * Show these tabs with `initial` selected (clamped). On close, focus returns to the element that
   * had it — the counter that opened the panel — unless `opener` names one explicitly.
   */
  show(tabs: readonly StatusTab[], initial?: number, opener?: HTMLElement | null): void;
  /** Hide the panel and release everything this showing held. */
  hide(): void;
  /** A provider's owner changed: redraw the visible tab. */
  refresh(): void;
  /** Showing: an outcome or a menu waits until it closes. */
  readonly isOpen: boolean;
  dispose(): void;
};

/** What a tab shows when its own provider could not supply content. */
export const tabFailureText = "This tab could not be shown.";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createStatusHost(
  host: HTMLElement,
  options: {
    /** The player closed the panel: the panel's Back block, Escape or the narrator's request. */
    close(): void;
    /** Reported to the developer, never to the player. */
    diagnose?(message: string): void;
  },
): StatusHost {
  const root = document.createElement("div");
  root.className = "status-host";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Run status");
  root.hidden = true;
  host.append(root);

  let tabs: readonly StatusTab[] = [];
  let selected = 0;
  /** The entry the player last inspected, so a redraw keeps them on it. */
  let inspected: string | null = null;
  /** What this showing holds: the visible tab's subscription and the element to return to. */
  let release: (() => void) | null = null;
  let opener: HTMLElement | null = null;
  let listener: ((event: KeyboardEvent) => void) | null = null;

  const current = (): StatusTab | null => tabs[selected] ?? null;
  const rowButtons = (): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>("[role='tab']"));

  function releaseShowing(): void {
    release?.();
    release = null;
  }

  /** Draw the tabs' state: which is selected, and which of them the Tab key reaches. */
  function drawTabs(): void {
    const row = root.querySelector<HTMLElement>(".status-tabs");
    if (!row) return;
    row.replaceChildren(
      ...tabs.map((tab, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "status-tab";
        button.id = `status-tab-${tab.id}`;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(index === selected));
        button.setAttribute("aria-controls", `status-panel-${tab.id}`);
        button.setAttribute("tabindex", index === selected ? "0" : "-1");
        button.textContent = tab.label;
        button.addEventListener("click", () => select(index));
        row.append(button);
        return button;
      }),
    );
  }

  /** Ask the visible tab for its content and draw it; its own failures stay inside its panel. */
  function drawPanel(): void {
    const tab = current();
    releaseShowing();
    const panel = root.querySelector<HTMLElement>(".status-panel");
    if (!tab || !panel) return;
    let content: TabContent;
    try {
      // Watching is what makes a later change redraw this tab, and nothing else redraws on it.
      release =
        tab.provider.watch?.(() => {
          if (root.hidden || current() !== tab) return;
          drawPanel();
        }) ?? null;
      content = tab.provider.content();
    } catch (error) {
      options.diagnose?.(`status tab "${tab.id}" failed: ${errorText(error)}`);
      content = { title: tab.label, summary: tabFailureText };
    }
    drawContent(panel, tab, content);
  }

  function drawContent(panel: HTMLElement, tab: StatusTab, content: TabContent): void {
    panel.setAttribute("aria-labelledby", `status-tab-${tab.id}`);
    const heading = document.createElement("h2");
    heading.className = "status-heading";
    heading.textContent = content.title;

    const summary = document.createElement("p");
    summary.className = "status-summary";
    summary.textContent = content.summary;

    const list = document.createElement("div");
    list.className = "status-rows";
    for (const row of content.rows ?? []) list.append(rowElement(row));

    const details = document.createElement("p");
    details.className = "status-details";
    details.setAttribute("aria-live", "polite");
    const kept = Array.from(list.querySelectorAll<HTMLElement>(".status-row")).find(
      (entry) => entry.dataset.ref === inspected,
    );
    details.textContent = kept?.getAttribute("aria-label") ?? "Focus or tap an entry to see it.";

    const unavailable = document.createElement("p");
    unavailable.className = "status-unavailable";
    unavailable.textContent = content.unavailable ?? "";
    unavailable.hidden = !content.unavailable;

    panel.replaceChildren(heading, summary, list, unavailable, details);
    // A redraw keeps the player on the entry they were inspecting, if it is still there.
    (kept ?? panel).focus({ preventScroll: false });
  }

  function rowElement(row: TabRow): HTMLElement {
    const entry = document.createElement("button");
    entry.type = "button";
    entry.className = "status-row";
    entry.textContent = row.text;
    if (row.ref !== undefined) entry.dataset.ref = row.ref;
    // Nothing more to say: it is a label, not a control that reveals anything.
    if (!row.inspect) {
      entry.disabled = true;
      return entry;
    }
    const text = row.inspect;
    entry.setAttribute("aria-label", text);
    const show = () => {
      inspected = row.ref ?? null;
      const details = root.querySelector<HTMLElement>(".status-details");
      if (details) details.textContent = text;
    };
    entry.addEventListener("pointerenter", show);
    entry.addEventListener("focus", show);
    entry.addEventListener("click", show);
    return entry;
  }

  /** Select a tab, and the focus and the panel that go with it. */
  function select(index: number): void {
    if (!tabs[index]) return;
    selected = index;
    inspected = null;
    drawTabs();
    drawPanel();
    // The panel, not a tab: choosing a tab is asking to read it.
    root.querySelector<HTMLElement>(".status-panel")?.focus();
  }

  function onKey(event: KeyboardEvent): void {
    if (isPanelCloseKey(event.key)) {
      event.preventDefault();
      options.close();
      return;
    }
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("[role='tab']");
    const index = button ? rowButtons().indexOf(button) : -1;
    if (index < 0) return;
    if (isTabActivationKey(event.key)) {
      event.preventDefault();
      select(index);
      return;
    }
    const next = tabFocusAfter(event.key, index, tabs.length);
    if (next === null) return;
    event.preventDefault();
    // Roving tabindex: only the tab with focus is reachable by Tab as well.
    for (const [at, element] of rowButtons().entries())
      element.setAttribute("tabindex", at === next ? "0" : "-1");
    rowButtons()[next]?.focus();
  }

  return {
    show(nextTabs, initial = 0, from = null) {
      tabs = [...nextTabs];
      selected = Math.min(Math.max(0, initial), Math.max(0, tabs.length - 1));
      inspected = null;
      // The panel takes focus, so remember what had it before: usually the counter that opened it.
      opener = from ?? (document.activeElement as HTMLElement | null);
      root.innerHTML =
        '<div class="status-tabs" role="tablist" aria-label="Status tabs"></div>' +
        '<div class="status-panel" role="tabpanel" tabindex="-1"></div>' +
        '<button type="button" class="status-back">Back</button>';
      root
        .querySelector<HTMLElement>(".status-back")
        ?.addEventListener("click", () => options.close());
      listener = onKey;
      root.addEventListener("keydown", listener);
      root.hidden = false;
      drawTabs();
      drawPanel();
      root.querySelector<HTMLElement>(".status-panel")?.focus();
    },
    hide() {
      releaseShowing();
      if (listener) root.removeEventListener("keydown", listener);
      listener = null;
      root.hidden = true;
      root.replaceChildren();
      tabs = [];
      inspected = null;
      if (opener?.isConnected) opener.focus();
      opener = null;
    },
    refresh() {
      if (root.hidden) return;
      drawPanel();
    },
    get isOpen() {
      return !root.hidden;
    },
    dispose() {
      this.hide();
      root.remove();
    },
  };
}
