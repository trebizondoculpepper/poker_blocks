import type { Cell } from "./traits/attachable";

export type MassCenter = { count: number; sum: Cell };

export function addCell(center: MassCenter, cell: Cell): MassCenter {
  return {
    count: center.count + 1,
    sum: {
      x: center.sum.x + cell.x,
      y: center.sum.y + cell.y,
      z: center.sum.z + cell.z,
    },
  };
}

/** The structure's mass with one cell taken away (a destroyed block). */
export function removeCell(center: MassCenter, cell: Cell): MassCenter {
  return {
    count: center.count - 1,
    sum: {
      x: center.sum.x - cell.x,
      y: center.sum.y - cell.y,
      z: center.sum.z - cell.z,
    },
  };
}

export function centerOfGravity(center: MassCenter): Cell {
  if (center.count === 0) throw new Error("Cannot find the center of an empty structure");
  return {
    x: center.sum.x / center.count,
    y: center.sum.y / center.count,
    z: center.sum.z / center.count,
  };
}
