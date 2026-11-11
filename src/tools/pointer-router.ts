/**
 * Pointer input for the cube stages (#462 review): turns pointer events over the cubes into
 * their `input.*` events. Only a pointer that can hover (a mouse) sends `input.enter`, so hover
 * inspection is genuine hover: a touch or pen contact presses without entering, and its tap
 * activates without an explanation popping up first (a long-press inspects instead). Moving off
 * a cube, lifting a touch, or the pointer leaving the stage sends `input.leave`; leaving the
 * stage also cancels every press.
 */
import type { Block } from "../core/block";

export type RoutedCube = { block: Block };

/** Whether a pointer can hover (a mouse), rather than only touch down. */
export const hovers = (pointerType: string): boolean => pointerType === "mouse";

export function createPointerRouter<Cube extends RoutedCube>(cubes: () => readonly Cube[]) {
  let current: Cube | null = null;
  function moveTo(next: Cube | null, hovering: boolean): void {
    if (next === current) return;
    current?.block.emit("input.leave");
    current = next;
    if (hovering) current?.block.emit("input.enter");
  }
  return {
    move(cube: Cube | null, pointerType: string): void {
      moveTo(cube, hovers(pointerType));
    },
    down(cube: Cube | null, pointerType: string): void {
      moveTo(cube, hovers(pointerType));
      current?.block.emit("input.press");
    },
    up(cube: Cube | null, pointerType: string): void {
      moveTo(cube, hovers(pointerType));
      cubes().forEach(({ block }) => block.emit("input.release"));
      // A touch is gone once lifted: it no longer rests on the cube.
      if (!hovers(pointerType)) moveTo(null, false);
    },
    /** The cubes were replaced: forget the old one without telling it anything. */
    forget(): void {
      current = null;
    },
    leave(): void {
      cubes().forEach(({ block }) => block.emit("input.cancel"));
      moveTo(null, false);
    },
  };
}
