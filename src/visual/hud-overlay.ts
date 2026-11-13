/**
 * A pointer-transparent HUD effect overlay host (#921, part of #500; doc/presentation-contracts.md,
 * "Laser target-guide controller"). One canvas over a host element, drawn by an orthographic
 * camera in CSS pixels of that host, so an effect can be placed exactly over a DOM element's live
 * rectangle. The device pixel ratio is applied once, to the drawing buffer only.
 *
 * It owns sizing and coordinates, not behaviour: callers add objects to its `scene`, ask
 * `rectOf(element)` for an element's overlay-local rectangle and re-place on `onLayout`, which
 * fires on host resize, window resize, scroll and changes to elements it was asked to `observe`.
 * The canvas clips to its host and never takes pointer events, so it cannot affect hit testing.
 * `dispose` releases the renderer, observers and listeners.
 */
import * as THREE from "three";

export type CssRect = { left: number; top: number; width: number; height: number };

/** A viewport rectangle (from `getBoundingClientRect`) in the host's own CSS pixels. */
export function toOverlayRect(viewport: CssRect, host: Pick<CssRect, "left" | "top">): CssRect {
  return {
    left: viewport.left - host.left,
    top: viewport.top - host.top,
    width: viewport.width,
    height: viewport.height,
  };
}

/**
 * The camera frustum for a host `width` × `height` CSS pixels: x right from the left edge, y up
 * from the top edge (so a CSS top `t` is world y `−t`).
 */
export function overlayFrustum(width: number, height: number) {
  return { left: 0, right: width, top: 0, bottom: -height };
}

/** Where an overlay object centred on `rect` goes, in the overlay camera's world. */
export function overlayCentre(rect: CssRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: -(rect.top + rect.height / 2) };
}

/** The drawing buffer for a CSS size: the device pixel ratio applied once, capped at 2. */
export function bufferSize(width: number, height: number, devicePixelRatio: number) {
  const ratio = Math.min(Math.max(devicePixelRatio || 1, 1), 2);
  return {
    ratio,
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export type HudOverlay = ReturnType<typeof createHudOverlay>;

export function createHudOverlay(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  const canvas = renderer.domElement;
  canvas.className = "hud-overlay";
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -100, 100);
  const listeners = new Set<() => void>();

  function layout(): void {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const buffer = bufferSize(width, height, window.devicePixelRatio);
    renderer.setPixelRatio(buffer.ratio);
    renderer.setSize(width, height, false);
    Object.assign(camera, overlayFrustum(width, height));
    camera.updateProjectionMatrix();
    for (const listener of listeners) listener();
  }

  const observer = new ResizeObserver(layout);
  observer.observe(host);
  window.addEventListener("resize", layout);
  // Scrolling anywhere moves targets relative to the host: capture it from every scroller.
  window.addEventListener("scroll", layout, { capture: true, passive: true });
  layout();

  return {
    scene,
    camera,
    /** An element's live rectangle in this overlay's CSS pixels. */
    rectOf(element: Element): CssRect {
      return toOverlayRect(element.getBoundingClientRect(), host.getBoundingClientRect());
    },
    /** Re-run layout listeners when this element's size changes; returns how to stop. */
    observe(element: Element): () => void {
      observer.observe(element);
      return () => observer.unobserve(element);
    },
    /** Called after every layout change; returns how to stop. */
    onLayout(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    render(): void {
      renderer.render(scene, camera);
    },
    dispose(): void {
      listeners.clear();
      observer.disconnect();
      window.removeEventListener("resize", layout);
      window.removeEventListener("scroll", layout, { capture: true });
      renderer.dispose();
      canvas.remove();
    },
  };
}
