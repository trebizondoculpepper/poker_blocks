import { describe, expect, it, vi } from "vite-plus/test";
import {
  defaultReturnFlight,
  returnToSource,
  stop,
  take,
  translateOffset,
  type ReturnableElement,
} from "./return-to-source";

/** An element stand-in that records its flights and lets a test land them. */
function element(translate = "") {
  const classes = new Set<string>();
  const flights: { keyframes: Keyframe[]; options: KeyframeAnimationOptions; land(): void }[] = [];
  const cancel = vi.fn();
  const el = {
    style: { translate },
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      let land = () => {};
      const finished = new Promise<void>((resolve) => (land = resolve));
      flights.push({ keyframes, options, land });
      return { finished, cancel } as unknown as Animation;
    },
  } as unknown as ReturnableElement;
  return { el, classes, flights, cancel };
}

describe("return to source (#482)", () => {
  it("reads a CSS translate as an offset", () => {
    expect(translateOffset("12px -4.5px")).toEqual({ x: 12, y: -4.5 });
    expect(translateOffset("7px")).toEqual({ x: 7, y: 0 });
    expect(translateOffset("none")).toEqual({ x: 0, y: 0 });
    expect(translateOffset("")).toEqual({ x: 0, y: 0 });
  });

  it("flies from the released offset back to rest in half a second, then lets go", async () => {
    const { el, classes, flights } = element("40px -20px");
    returnToSource(el, { reducedMotion: false, className: "is-returning" });
    // The resting style is restored at once; the flight alone carries it home, so no snap.
    expect(el.style.translate).toBe("");
    expect(flights).toHaveLength(1);
    expect(flights[0]!.keyframes).toEqual([{ translate: "40px -20px" }, { translate: "0px 0px" }]);
    expect(flights[0]!.options.duration).toBe(defaultReturnFlight.seconds * 1000);
    expect(defaultReturnFlight.seconds).toBe(0.5);
    expect(classes.has("is-returning")).toBe(true);
    flights[0]!.land();
    await Promise.resolve();
    await Promise.resolve();
    expect(classes.has("is-returning")).toBe(false);
  });

  it("puts it straight back with reduced motion, or when it never moved", () => {
    const reduced = element("40px 0px");
    returnToSource(reduced.el, { reducedMotion: true });
    expect(reduced.el.style.translate).toBe("");
    expect(reduced.flights).toHaveLength(0);
    const still = element("");
    returnToSource(still.el, { reducedMotion: false });
    expect(still.flights).toHaveLength(0);
  });

  it("retaken mid-flight, it stays where it is and says where that is", () => {
    const { el, classes, cancel } = element("40px 20px");
    returnToSource(el, { reducedMotion: false, className: "is-returning" });
    const here = take(el, () => "10px 5px");
    expect(here).toEqual({ x: 10, y: 5 });
    expect(el.style.translate).toBe("10px 5px");
    expect(cancel).toHaveBeenCalledOnce();
    expect(classes.has("is-returning")).toBe(false);
    // Not flying: taking it reads its own offset and changes nothing.
    expect(take(el, () => "99px 99px")).toEqual({ x: 10, y: 5 });
  });

  it("stopping (removal, scene exit) ends the flight and its class", () => {
    const { el, classes, cancel } = element("40px 20px");
    returnToSource(el, { reducedMotion: false, className: "is-returning" });
    stop(el);
    expect(cancel).toHaveBeenCalledOnce();
    expect(classes.has("is-returning")).toBe(false);
    stop(el);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
