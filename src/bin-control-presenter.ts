/**
 * The shop Sell target as a 3D control block (#1078; doc/shop-control-blocks.md, "Three configured
 * controls" and "Preserve Buy and Sell ownership"): a steel cube with SELL and a dustbin motif on
 * the shared control stage, drawn inside the bin while a scene composing `sellBin` names this
 * presenter. Presentation only: the bin element stays the drop target, and sale/refusal belong to
 * the drop owner. The normal-play Discard bin is untouched.
 */
import * as THREE from "three";
import { createControlStage, type ControlStage } from "./block-menu/control-stage";
import { binPresenters } from "./bin-view";
import { sparkleEnvironment } from "./visual/attract-look";
import { withMotif } from "./visual/motif-face-art";

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

binPresenters.register("controlBlock", {
  mount(element) {
    const host = document.createElement("div");
    host.className = "bin-control-cube";
    element.prepend(host);
    let stage: ControlStage | null = null;
    let disposed = false;
    void createControlStage(
      {
        element: host,
        createRenderer: () => new THREE.WebGLRenderer({ alpha: true, antialias: true }),
        requestFrame: (callback) => requestAnimationFrame(callback),
        cancelFrame: (handle) => cancelAnimationFrame(handle),
        environment: (renderer) => sparkleEnvironment(renderer as THREE.WebGLRenderer, 0),
      },
      [
        {
          id: "sell",
          label: "SELL",
          description: "Drop an installed item here to sell it.",
          layout: ({ width, height }) => ({
            x: width / 2,
            y: height / 2,
            size: Math.min(width, height) * 0.62,
          }),
          cube: {
            material: "steel",
            artwork: withMotif({ handler: "dustbin" }),
            precession: { reducedMotion: reducedMotion() },
          },
        },
      ],
    ).then((made) => {
      if (disposed) return made.dispose();
      stage = made;
      stage.resume();
    });
    return {
      dispose() {
        disposed = true;
        stage?.dispose();
        host.remove();
      },
    };
  },
});
