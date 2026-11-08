export const faces = ["north", "south", "east", "west", "up", "down"] as const;
export type Face = (typeof faces)[number];

export type Cell = { x: number; y: number; z: number };
export type AttachableTrait = { faces: readonly Face[] };

const offsets: Record<Face, Cell> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
};

export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

export function faceNormal(face: Face): Cell {
  return offsets[face];
}

export function faceFromNormal(normal: Cell): Face {
  const face = faces.find((candidate) => {
    const offset = offsets[candidate];
    return offset.x === normal.x && offset.y === normal.y && offset.z === normal.z;
  });
  if (!face) throw new Error("Invalid face normal");
  return face;
}

/**
 * The face a surface direction points out of: its strongest axis. Works on bevelled or
 * rounded blocks too, where a hit can land on a slanted surface between two faces.
 */
export function faceFromDirection(direction: Cell): Face {
  const ax = Math.abs(direction.x);
  const ay = Math.abs(direction.y);
  const az = Math.abs(direction.z);
  if (ax >= ay && ax >= az) return direction.x >= 0 ? "east" : "west";
  if (ay >= az) return direction.y >= 0 ? "up" : "down";
  return direction.z >= 0 ? "south" : "north";
}

export function attachmentCell(
  trait: AttachableTrait | undefined,
  target: Cell,
  face: Face,
  occupied: ReadonlySet<string>,
): Cell | null {
  if (!trait?.faces.includes(face)) return null;
  const offset = offsets[face];
  const neighbor = {
    x: target.x + offset.x,
    y: target.y + offset.y,
    z: target.z + offset.z,
  };
  return occupied.has(cellKey(neighbor)) ? null : neighbor;
}
