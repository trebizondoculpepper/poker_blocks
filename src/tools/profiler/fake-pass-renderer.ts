/** A test double for the renderer state passes change (#764): no WebGL needed. */
import * as THREE from "three";

/** The render-state methods a pass may change, kept as plain state (#764). */
export function passRenderer() {
  let target: THREE.WebGLRenderTarget | null = null;
  const clear = new THREE.Color(0x000000);
  let alpha = 1;
  return {
    render() {},
    clear() {},
    getRenderTarget: () => target,
    setRenderTarget(next: THREE.WebGLRenderTarget | null) {
      target = next;
    },
    getClearColor: (into: THREE.Color) => into.copy(clear),
    setClearColor(colour: THREE.ColorRepresentation, nextAlpha = 1) {
      clear.set(colour);
      alpha = nextAlpha;
    },
    getClearAlpha: () => alpha,
    getDrawingBufferSize: (into: THREE.Vector2) => into.set(320, 180),
  };
}
