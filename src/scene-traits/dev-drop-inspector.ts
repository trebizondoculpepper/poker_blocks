/**
 * DevDropInspector (testing only; the dev10 room): a live panel for debugging drag and drop.
 * It shows the watched state (whether an animation is holding drops back, a drag or held drop,
 * the model's block count against the drawn one) and the newest entries of the action log, so
 * you can see a failure as it happens. Copying the full history is the `actionHistory` trait's
 * job. It only watches; it never changes what the input does. Dev traits are only for testing.
 */
import type { ActionLog } from "../action-log";
import type { SceneTraitBehaviour } from "../scenes";
import type { ActionWatch } from "./action-history";

export type DevDropInspectorConfig = Record<never, never>;

/** How many of the newest log entries the panel shows. */
const shownEntries = 14;

export function devDropInspector<
  Context extends {
    host: HTMLElement;
    services: { actionLog: ActionLog; actionWatch: Pick<ActionWatch, "state"> };
  },
>(): SceneTraitBehaviour<Context, DevDropInspectorConfig> {
  let panel: HTMLElement | null = null;
  let shown = "";
  return {
    enter({ host }) {
      panel = document.createElement("aside");
      panel.className = "dev-drop-inspector";
      panel.setAttribute("aria-label", "Drop inspector");
      host.append(panel);
      shown = "";
    },
    exit() {
      panel?.remove();
      panel = null;
    },
    update({ services: { actionLog, actionWatch } }) {
      if (!panel) return;
      const state = Object.entries(actionWatch.state())
        .map(
          ([key, value]) =>
            `<span class="${value === true ? "is-on" : ""}">${key}: ${String(value)}</span>`,
        )
        .join("");
      const entries = actionLog.entries();
      const last = entries[entries.length - 1]?.at ?? 0;
      const rows = entries
        .slice(-shownEntries)
        .reverse()
        .map(
          ({ at, source, event, detail }) =>
            `<li><time>-${((last - at) / 1000).toFixed(2)}s</time><b>${source} ${event}</b> ${detail}</li>`,
        )
        .join("");
      const html = `<h2>Drop inspector</h2><p class="dev-drop-state">${state}</p><ol class="dev-drop-trace">${rows}</ol>`;
      if (html !== shown) {
        panel.innerHTML = html;
        shown = html;
      }
    },
  };
}
