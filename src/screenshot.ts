import "./screenshot.css";
import type * as THREE from "three";
import { playSfx } from "./audio/sfx";

export const screenshotWidth = 3840;
export const screenshotHeight = 2160;

export function isScreenshotShortcut(
  event: Pick<KeyboardEvent, "code" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey" | "repeat">,
): boolean {
  return (
    event.code === "KeyK" &&
    event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.repeat
  );
}

/** Preserve the visible window's aspect inside an exact UHD canvas. */
export function screenshotLayout(
  width: number,
  height: number,
  maxDimension = Infinity,
): {
  scale: number;
  width: number;
  height: number;
  x: number;
  y: number;
} | null {
  if (!(width > 0 && height > 0 && maxDimension > 0)) return null;
  const scale = Math.min(
    screenshotWidth / width,
    screenshotHeight / height,
    maxDimension / width,
    maxDimension / height,
  );
  if (!(scale > 0 && Number.isFinite(scale))) return null;
  const imageWidth = Math.max(1, Math.floor(width * scale));
  const imageHeight = Math.max(1, Math.floor(height * scale));
  return {
    scale,
    width: imageWidth,
    height: imageHeight,
    x: Math.floor((screenshotWidth - imageWidth) / 2),
    y: Math.floor((screenshotHeight - imageHeight) / 2),
  };
}

function maxRenderDimension(renderer: THREE.WebGLRenderer): number {
  const gl = renderer.getContext();
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  return Math.min(
    renderer.capabilities.maxTextureSize,
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    viewport[0],
    viewport[1],
  );
}

/**
 * The table's layers, bottom to top, with the DOM overlay between them (#116): the back canvas
 * (room and table), the HUD and menus, then the front canvas (blocks, hand, drag).
 */
export type ScreenshotLayers = {
  back: THREE.WebGLRenderer;
  front: THREE.WebGLRenderer;
};

/**
 * Whether a child of the game's host draws over the front canvas: a higher z-index, or the same
 * one later in the page (the passive rack, shop overlays, menus).
 */
function drawsOver(element: HTMLElement, frontCanvas: HTMLElement): boolean {
  const z = (node: HTMLElement) => Number.parseInt(getComputedStyle(node).zIndex, 10) || 0;
  const mine = z(element);
  const front = z(frontCanvas);
  if (mine !== front) return mine > front;
  return Boolean(frontCanvas.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** A WebGL canvas copied to a 2D one, so it survives the next frame. */
function copyCanvas(renderer: THREE.WebGLRenderer): HTMLCanvasElement {
  renderer.getContext().finish();
  const copy = document.createElement("canvas");
  copy.width = renderer.domElement.width;
  copy.height = renderer.domElement.height;
  const context = copy.getContext("2d");
  if (!context) throw new Error("Could not capture the game canvas.");
  context.drawImage(renderer.domElement, 0, 0);
  return copy;
}

async function capture(
  host: HTMLElement,
  layers: ScreenshotLayers,
  render: () => void,
): Promise<Blob> {
  const { back, front } = layers;
  const bounds = host.getBoundingClientRect();
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  const layout = screenshotLayout(
    width,
    height,
    Math.min(maxRenderDimension(back), maxRenderDimension(front)),
  );
  if (!layout) throw new Error("The game view has no drawable size.");
  const oldRatio = back.getPixelRatio();
  let backImage: HTMLCanvasElement;
  let frontImage: HTMLCanvasElement;
  let under: HTMLCanvasElement;
  let over: HTMLCanvasElement;
  try {
    // Freeze both WebGL layers before the asynchronous DOM capture.
    for (const renderer of [back, front]) renderer.setPixelRatio(layout.scale);
    render();
    backImage = copyCanvas(back);
    frontImage = copyCanvas(front);
    const { toCanvas } = await import("html-to-image");
    // The DOM in two parts either side of the front canvas: the HUD under the blocks, and the
    // rack, shop overlays and menus over them, as on screen.
    const domLayer = (above: boolean) =>
      toCanvas(host, {
        filter: (node) =>
          node !== back.domElement &&
          node !== front.domElement &&
          (node === host || layerOf(node) === above),
        pixelRatio: layout.scale,
        width,
        height,
        skipAutoScale: true,
      });
    const layerOf = (node: Node): boolean => {
      let top: Node | null = node;
      while (top && top.parentNode !== host) top = top.parentNode;
      return top instanceof HTMLElement ? drawsOver(top, front.domElement) : false;
    };
    under = await domLayer(false);
    over = await domLayer(true);
  } finally {
    for (const renderer of [back, front]) renderer.setPixelRatio(oldRatio);
    render();
  }
  const output = document.createElement("canvas");
  output.width = screenshotWidth;
  output.height = screenshotHeight;
  const context = output.getContext("2d");
  if (!context) throw new Error("Could not create a screenshot canvas.");
  context.fillStyle = "#111726";
  context.fillRect(0, 0, output.width, output.height);
  // In the screen's own order: the room, the HUD, the blocks, then the rack, shop and menus.
  for (const image of [backImage, under, frontImage, over])
    context.drawImage(image, layout.x, layout.y, layout.width, layout.height);
  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode the screenshot.");
  return blob;
}

function screenshotName(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  return `poker-blocks-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}.png`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Copy the whole game view, including DOM overlays, with a save fallback. */
export function bindScreenshotShortcut(
  host: HTMLElement,
  layers: ScreenshotLayers,
  render: () => void,
): () => void {
  const notice = document.createElement("div");
  notice.className = "screenshot-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.hidden = true;
  document.body.append(notice);
  let timer = 0;
  let busy = false;
  const show = (message: string, save?: () => void) => {
    notice.replaceChildren(message);
    if (save) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Save PNG";
      button.addEventListener("click", save);
      notice.append(" ", button);
    }
    notice.hidden = false;
    window.clearTimeout(timer);
    timer = window.setTimeout(
      () => {
        notice.hidden = true;
      },
      save ? 12000 : 4000,
    );
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isScreenshotShortcut(event)) return;
    event.preventDefault();
    if (busy) return;
    busy = true;
    playSfx("ui.screenshot");
    show("Capturing 4K screenshot…");
    const name = screenshotName();
    // Start clipboard.write in the key gesture; Safari requires this ordering.
    const png = capture(host, layers, render);
    png.catch(() => {});
    let copied: Promise<void>;
    try {
      copied =
        typeof ClipboardItem === "function" && navigator.clipboard?.write
          ? navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
          : Promise.reject(new Error("Image clipboard unavailable"));
    } catch (error) {
      copied = Promise.reject(error);
    }
    void copied
      .then(async () => {
        const blob = await png;
        show("4K screenshot copied to clipboard. Save a copy:", () => download(blob, name));
        busy = false;
      })
      .catch(async () => {
        try {
          const blob = await png;
          download(blob, name);
          show("4K screenshot saved. You can save it again here:", () => download(blob, name));
        } catch (error) {
          console.error("Screenshot failed", error);
          show("Could not capture a screenshot");
        } finally {
          busy = false;
        }
      });
  };
  window.addEventListener("keydown", onKeyDown);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.clearTimeout(timer);
    notice.remove();
  };
}
