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
