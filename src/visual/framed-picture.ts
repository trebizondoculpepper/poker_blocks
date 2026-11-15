/**
 * Framed picture (#1086; doc/line-goes-up.md, "Framed picture and scenery placement"): a reusable
 * piece of scenery that shows any picture surface in a frame. It owns its frame geometry, its
 * materials and the surface mesh; the composing scene owns everything else, as data: the parent it
 * is added to, its position, orientation and size, the frame's appearance and any attachment
 * points.
 *
 * It knows no graph, score, stage or room: any texture can be framed (the plot surface's, a
 * photograph's), and a second picture is another call with another transform. The picture's
 * texture belongs to whoever supplied it, so disposing the frame never disposes it.
 *
 * Attachment points are plain geometry in the object's local space (by default a nail at each
 * top corner, `left` and `right`), for effects that hang, swing or release the frame (#1065).
 * They carry no policy about when anything happens.
 */
import * as THREE from "three";

export type FrameAppearance = {
  /** The border's width around the picture, in world units. */
  border: number;
  /** How far the frame stands out from the wall. */
  depth: number;
  colour: string;
  /** 0 matte to 1 mirror-like. */
  roughness: number;
};

export const defaultFrameAppearance: FrameAppearance = {
  border: 0.08,
  depth: 0.06,
  colour: "#5b4128",
  roughness: 0.7,
};

export type FramedPictureConfig = {
  /** The picture's visible size, in world units (the frame goes around it). */
  size: { width: number; height: number };
  /** Where it sits in its parent's space, and which way it faces (Euler radians, XYZ). */
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  frame?: Partial<FrameAppearance>;
  /**
   * Named attachment points in the object's local space. Left out: a nail at each top corner of
   * the frame, `left` and `right`.
   */
  attachments?: Readonly<Record<string, readonly [number, number, number]>>;
};

export type FramedPicture = {
  /** The scenery object: add it to the scene's chosen parent. */
  readonly object: THREE.Group;
  /** Attachment points by name, as local positions on `object`. */
  readonly attachments: ReadonlyMap<string, THREE.Vector3>;
  /** Show another picture; the old texture is the supplier's, so it isn't disposed. */
  setPicture(texture: THREE.Texture | null): void;
  /** Dispose of the frame's own geometry and materials; the picture's texture is left alone. */
  dispose(): void;
};

/** Nails at the frame's two top corners, slightly in from the edge and proud of its face. */
export function defaultAttachments(
  size: FramedPictureConfig["size"],
  frame: FrameAppearance,
): Record<string, [number, number, number]> {
  const x = size.width / 2 + frame.border / 2;
  const y = size.height / 2 + frame.border / 2;
  return { left: [-x, y, frame.depth / 2], right: [x, y, frame.depth / 2] };
}

export function createFramedPicture(
  config: FramedPictureConfig,
  picture: THREE.Texture | null = null,
): FramedPicture {
  const frame = { ...defaultFrameAppearance, ...config.frame };
  const { width, height } = config.size;
  const object = new THREE.Group();
  object.name = "framed-picture";
  object.position.set(...config.position);
  object.rotation.set(...(config.rotation ?? [0, 0, 0]));

  // The frame: four bars around the picture, standing out by its depth.
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: frame.colour,
    roughness: frame.roughness,
  });
  const outerWidth = width + 2 * frame.border;
  const bars: [number, number, number, number][] = [
    // [width, height, x, y]
    [outerWidth, frame.border, 0, height / 2 + frame.border / 2],
    [outerWidth, frame.border, 0, -height / 2 - frame.border / 2],
    [frame.border, height, -width / 2 - frame.border / 2, 0],
    [frame.border, height, width / 2 + frame.border / 2, 0],
  ];
  const barGeometries = bars.map(([w, h]) => new THREE.BoxGeometry(w, h, frame.depth));
  bars.forEach(([, , x, y], index) => {
    const bar = new THREE.Mesh(barGeometries[index], frameMaterial);
    bar.position.set(x, y, frame.depth / 2);
    bar.name = "frame";
    object.add(bar);
  });

  // The picture: a plane set just behind the frame's face, lit like the room.
  const surfaceGeometry = new THREE.PlaneGeometry(width, height);
  const surfaceMaterial = new THREE.MeshStandardMaterial({
    map: picture,
    color: picture ? "#ffffff" : "#cccccc",
    roughness: 0.9,
  });
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  surface.name = "picture";
  surface.position.z = frame.depth * 0.25;
  object.add(surface);

  const attachments = new Map(
    Object.entries(config.attachments ?? defaultAttachments(config.size, frame)).map(
      ([name, at]) => [name, new THREE.Vector3(...at)] as const,
    ),
  );

  return {
    object,
    attachments,
    setPicture(texture) {
      surfaceMaterial.map = texture;
      surfaceMaterial.color.set(texture ? "#ffffff" : "#cccccc");
      surfaceMaterial.needsUpdate = true;
    },
    dispose() {
      object.removeFromParent();
      for (const geometry of [...barGeometries, surfaceGeometry]) geometry.dispose();
      frameMaterial.dispose();
      // The picture's texture belongs to its supplier.
      surfaceMaterial.map = null;
      surfaceMaterial.dispose();
    },
  };
}
