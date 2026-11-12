/**
 * The four-pointed star and its lifecycle (#349, extracted from the crystal attract trail,
 * #203): shared by the title's `rainbowStars` trail and the contained `stars` effect, so both
 * use the same artwork and the same bright-birth, twinkle and squared-fade life. Colour is each
 * user's own: the trail keeps its rainbow, the contained stars follow a configured ramp.
 */
import * as THREE from "three";

/** A soft four-pointed star, white on transparent, for additive sprites to colour. */
function drawStar(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const centre = size / 2;
  // Four long, thin, bright rays, fading toward their tips: the star.
  for (const angle of [0, Math.PI / 2]) {
    g.save();
    g.translate(centre, centre);
    g.rotate(angle);
    const ray = g.createLinearGradient(-centre, 0, centre, 0);
    ray.addColorStop(0, "rgba(255,255,255,0)");
    ray.addColorStop(0.5, "rgba(255,255,255,1)");
    ray.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = ray;
    g.beginPath();
    g.moveTo(-centre, 0);
    g.quadraticCurveTo(0, -1.6, centre, 0);
    g.quadraticCurveTo(0, 1.6, -centre, 0);
    g.fill();
    g.restore();
  }
  // A small, tight core where the rays cross: a glint, not a disc.
  const core = g.createRadialGradient(centre, centre, 0, centre, centre, size * 0.14);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = core;
  g.beginPath();
  g.arc(centre, centre, size * 0.14, 0, Math.PI * 2);
  g.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let shared: THREE.Texture | null = null;

/** The one star texture every star effect shares; never disposed by a single user. */
export function starTexture(): THREE.Texture {
  if (!shared) {
    shared = drawStar();
    // Shared: whoever frees a block's own textures must leave this one (#653 review).
    shared.userData.shared = true;
  }
  return shared;
}

/**
 * A star's brightness at `age` of a `life`: brighter than white when young (additive, so a
 * fresh star blooms), a gentle twinkle, and a squared fade to nothing. 0 once its life is over.
 * `twinkle` scales the twinkle (0 holds it steady, for reduced motion).
 */
export function starBrightness(age: number, life: number, index: number, twinkle = 1): number {
  const left = Math.max(0, 1 - age / life);
  const shimmer = 1 - 0.25 * twinkle + 0.25 * twinkle * Math.sin(age * 18 + index);
  return 1.8 * left * left * shimmer;
}
