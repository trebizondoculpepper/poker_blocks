/**
 * Long-press inspection (#462, owner's answer): a normal tap activates; holding a press for
 * `holdSeconds` inspects instead. Recognising the hold cancels the press (`input.cancel`), so
 * releasing afterwards activates nothing, then asks for inspection (`inspect.request`). Leaving
 * the block (moving off it), releasing or cancelling before the threshold stops the hold. It
 * reads only the block's own input events and its per-frame update: no input of its own.
 */
import { defineTrait } from "../core/trait";

export const longPressInspect = defineTrait({
  name: "longPressInspect",
  defaults: { holdSeconds: 0.5 },
  setup({ block, settings }) {
    let held: number | null = null;
    const stop = () => void (held = null);
    const stops = [
      block.on("input.press", () => void (held = 0)),
      block.on("input.release", stop),
      block.on("input.cancel", stop),
      block.on("input.leave", stop),
    ];
    return {
      update(dt: number) {
        if (held === null) return;
        held += dt;
        if (held < settings.holdSeconds) return;
        held = null;
        block.emit("input.cancel");
        block.emit("inspect.request");
      },
      dispose: () => stops.forEach((each) => each()),
    };
  },
});
