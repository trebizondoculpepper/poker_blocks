/**
 * ActionHistory: while a scene composing it is showing, record interaction events and the
 * game's callbacks into the action log (src/action-log.ts), and show a button that copies the
 * last 30 seconds of entries, with their precise timestamps, to the clipboard as plain text. After a
 * failure (a drop that didn't respond, say) the history can be pasted straight into a report.
 *
 * It records:
 * - raw pointer events on the page (down, up and cancel, with position, pointer type, buttons
 *   and the element hit), with moves folded into one running entry per run;
 * - window blur and visibility changes, which cancel gestures;
 * - every change in the watched state: animating, presenting, dragging, a held drop, and the
 *   model's block count against the drawn one;
 * - the input's own decisions, which reach the log through the input's trace hook.
 *
 * Composed only into the dev10 room for now; composing it into another mode's scenes is all it
 * takes to record there. It never changes what the game does.
 */
import { formatActionLog, type ActionLog } from "../action-log";
import type { SceneTraitBehaviour } from "../scenes";

/** What the history watches and puts in its header. */
export type ActionWatch = {
  /** Values whose every change is recorded. */
  state(): Record<string, string | number | boolean>;
  /** Lines for the top of the copied history: version, mode, screen, the scene stack… */
  header(): [string, string][];
};

export type ActionHistoryConfig = Record<never, never>;

type Recording = {
  stop(): void;
  last: Record<string, string | number | boolean>;
};

const describeTarget = (target: EventTarget | null) => {
  const element = target as Element | null;
  if (!element?.tagName) return "?";
  const className = typeof element.className === "string" ? element.className.split(" ")[0] : "";
  return `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`;
};

export function actionHistory<
  Context extends {
    host: HTMLElement;
    services: { actionLog: ActionLog; actionWatch: ActionWatch };
  },
>(): SceneTraitBehaviour<Context, ActionHistoryConfig> {
  let recording: Recording | null = null;

  return {
    enter({ host, services: { actionLog, actionWatch } }) {
      recording?.stop();
      const stopLog = actionLog.start();
      const pointer = (event: PointerEvent) =>
        actionLog.record(
          "pointer",
          event.type.replace("pointer", ""),
          `${event.pointerType} (${Math.round(event.clientX)},${Math.round(event.clientY)}) id${event.pointerId} buttons${event.buttons} on ${describeTarget(event.target)}`,
        );
      const move = (event: PointerEvent) => actionLog.move(event.clientX, event.clientY);
      const blur = () => actionLog.record("window", "blur");
      const visibility = () => actionLog.record("window", `visibility ${document.visibilityState}`);
      const types = ["pointerdown", "pointerup", "pointercancel"] as const;
      for (const type of types) host.addEventListener(type, pointer, true);
      host.addEventListener("pointermove", move, true);
      window.addEventListener("blur", blur);
      document.addEventListener("visibilitychange", visibility);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "action-history-copy";
      button.textContent = "Copy action history";
      button.title =
        "Copy the last 30 seconds of interaction events, with timestamps, to the clipboard";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const text = formatActionLog(actionLog.entries(), [
          ["copied", new Date().toISOString()],
          ...actionWatch.header(),
          ...Object.entries(actionWatch.state()).map(([key, value]): [string, string] => [
            key,
            String(value),
          ]),
        ]);
        void navigator.clipboard.writeText(text).then(
          () => (button.textContent = "Copied"),
          () => (button.textContent = "Copy failed"),
        );
        setTimeout(() => (button.textContent = "Copy action history"), 1500);
      });
      host.append(button);

      actionLog.record("scene", "history started");
      recording = {
        last: actionWatch.state(),
        stop() {
          stopLog();
          for (const type of types) host.removeEventListener(type, pointer, true);
          host.removeEventListener("pointermove", move, true);
          window.removeEventListener("blur", blur);
          document.removeEventListener("visibilitychange", visibility);
          button.remove();
        },
      };
    },
    exit() {
      recording?.stop();
      recording = null;
    },
    update({ services: { actionLog, actionWatch } }) {
      if (!recording) return;
      const next = actionWatch.state();
      for (const [key, value] of Object.entries(next))
        if (recording.last[key] !== value)
          actionLog.record("state", key, `${String(recording.last[key])} → ${String(value)}`);
      recording.last = next;
    },
  };
}
