/**
 * Input service: what the player does with a pointer on the table. It turns pointer events
 * into gestures (dragging a hand card to play, discard or reorder it, carrying the rest of
 * the selection; dragging the board to rotate it; pinching or scrolling to zoom; clicking
 * to select; dragging a passive to sell or reorder it) and owns the discard target and the
 * selection.
 *
 * The rules decide whether a gesture is allowed and what it does to the run; the game
 * supplies them through `TableRules`. Each gesture plays its sound here, as it happens.
 */
import { Gesture } from "@use-gesture/vanilla";
import { Registry } from "./core/registry";
import {
  DragDropManager as DndKitManager,
  type Draggable,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import {
  createDragDropManager,
  type DragSource,
  type DragSourceConfig,
  type DropHit,
  type DropTarget,
  type DropTargetConfig,
  type DropVerdict,
} from "./drag-drop";
import * as THREE from "three";
import type { AudioService } from "./audio-service";
import { playSfx } from "./audio/sfx";
import type { CameraViewService } from "./camera-view";
import type { CardBlock } from "./cards";
import type { Candidate, FieldView } from "./field-view";
import type { HandDrag, HandView } from "./hand-view";
import type { Overlays } from "./overlays";
import { passiveAppearance, type PassiveBlock } from "./passives";
import type { RenderedBlock } from "./rendered-blocks";
import { cellKey, type Cell, type Face } from "./traits/attachable";
import { inspectBlock } from "./traits/inspectable";
import { createHoldGesture } from "./hold-gesture";

/** How far above a holding finger its inspection label sits, in CSS pixels. */
const holdLabelLift = 110;
import { blockCanDrag, blockCursor, toggleBlockSelection } from "./block-trait-behaviours";
import type { Selection } from "./traits/selectable";
import { moveItem } from "./zones";

/** What the input asks of the run. */
export type TableRules = {
  /** A play or discard is still animating: the table takes no new gestures. */
  busy(): boolean;
  inStage(): boolean;
  canPlay(): boolean;
  canDiscard(): boolean;
  /** The cells a line of `count` blocks would fill: from a face, or the empty field's centre. */
  linePlacement(count: number, targetId?: string, face?: Face): Cell[] | null;
  /** The hand, in order. */
  hand(): readonly CardBlock[];
  /** Play blocks (in this order) at a candidate; false when the rules refuse. */
  play(blocks: readonly RenderedBlock[], candidate: Candidate): boolean;
  /** Discard blocks as one discard; false when the rules refuse. */
  discard(blocks: readonly RenderedBlock[]): boolean;
  /** Move a hand card from one slot to another. */
  reorderHand(from: number, to: number): void;
  /** The passive rack, in order. */
  passiveRack(): readonly PassiveBlock[];
  canSellPassives(): boolean;
  reorderPassive(from: number, to: number): boolean;
  /** Sell a passive; false when the rules refuse. */
  sellPassive(id: string): boolean;
};

/** The passive rack view, as far as dragging a passive needs it. */
type RackDragTarget = {
  lift(id: string | null): void;
  slotAt(clientX: number, clientY: number): number | null;
  preview(order: readonly string[] | null): void;
};

export type TableInput = {
  /**
   * A scene composing `handView` came to the front, or left (#183). The hand can be hovered,
   * selected and dragged only while any such scene is on the stack; drawing it is the
   * renderer's half of the same trait.
   */
  handEntered(entered: boolean): void;
  /**
   * A scene composing `discardBin` came to the front, or left (#183). The bin, which is also
   * the passives' sell target, is shown while any such scene is on the stack.
   */
  discardBinEntered(entered: boolean): void;
  /**
   * Allow a drop target while a scene shows (the `dropTarget` trait, #273); returns a function
   * that disallows it again.
   */
  enableDropTarget(config: DropTargetConfig): () => void;
  /**
   * Allow a drag source while a scene shows (the `dragSource` trait, #282); returns a function
   * that disallows it again.
   */
  enableDragSource(config: DragSourceConfig): () => void;
  /**
   * Bind the board gestures while a scene shows (the `boardGestures` trait, #275): dragging the
   * structure turns it, a pinch zooms and a two-finger twist turns it, the wheel zooms. Returns
   * a function that unbinds them.
   */
  enableBoardGestures(): () => void;
  /** A shop scene composes the same target as Sell, without exposing Discard. */
  sellBinEntered(entered: boolean): void;
  /** The selected block ids (hand and field). */
  readonly selection: Selection;
  /** Forget these blocks from the selection (they were played or discarded). */
  deselect(ids: Iterable<string>): void;
  clearSelection(): void;
  /** The card being dragged, once the drag has really started. */
  handDrag(): HandDrag | null;
  /** Whether a hand card or the board is being dragged. */
  readonly dragging: boolean;
  /** The cell a dragged block would be played into right now, if any. */
  readonly candidateCell: Cell | null;
  /** The scene in front allows (or no longer allows) blocks to be played onto the field. */
  setFieldActive(active: boolean): void;
  /**
   * Abandon every gesture in progress (a hand, board or passive drag, a hold, a pinch): nothing
   * is played, discarded, sold or rotated, and dragged blocks return (#124).
   */
  cancelGestures(): void;
  /** Pick up a passive from the rack (its cube's pointerdown). */
  pickUpPassive(block: PassiveBlock, event: PointerEvent): void;
  /** Refresh the discard target: exhausted when no discards are left, armed with a count. */
  refreshDiscardTarget(): void;
  /** The id of the table block under a screen point, if any. */
  fieldBlockAt(clientX: number, clientY: number): string | undefined;
  /** Per frame: keep a dragged card's drop target current as the board moves under it. */
  frame(): void;
  dispose(): void;
};

/** Blocks being dragged sit on their own layer and are drawn last. */
type DragLayer = (cube: THREE.Object3D, dragging: boolean) => void;

type Drag = {
  source: RenderedBlock;
  grabOffset: THREE.Vector3;
  pointerId: number;
  active: boolean;
  candidate: Candidate | null;
  /** The last drop target the trace reported, so it reports only changes. */
  tracedTarget?: string;
  /** The drop target hit at the point under the pointer (#273), if any. */
  hit: DropHit | null;
  /** Other selected hand blocks carried with the dragged one (a group discard). */
  group: RenderedBlock[];
  /** Hand position the dragged card would move to if dropped inside the hand. */
  reorderSlot: number | null;
  lastX: number;
  lastY: number;
};

const normalMotionRate = 1;

/**
 * The shared lower-screen drop target: Discard for hand cards, Sell while a passive is
 * dragged. Built early so it keeps its place among the table's overlays.
 */
export function createDiscardTarget(host: HTMLElement): HTMLElement {
  const discardArea = document.createElement("div");
  discardArea.className = "discard-area";
  // A drop target and a button: it takes pointers even inside the pass-through HUD frame.
  discardArea.dataset.interactive = "";
  discardArea.setAttribute("aria-label", "Discard area");
  discardArea.setAttribute("role", "button");
  discardArea.innerHTML = `
  <svg class="discard-icon" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
    <path d="M6 1h4v2H6zM3 3h10v2H3zM4 6h8v7h-1v2H5v-2H4z" />
    <path class="discard-icon-cutout" d="M6 8h1v5H6zM9 8h1v5H9z" />
  </svg>
  <svg class="sell-icon" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
    <path d="M5 2h6v1h2v2h1v6h-1v2h-2v1H5v-1H3v-2H2V5h1V3h2z" />
    <path class="sell-icon-mark" d="M7 4h2v1h2v2H8v1h3v4H9v1H7v-1H5V9h3V8H5V5h2z" />
  </svg>
  <span class="discard-label">DISCARD</span>
  <b class="discard-count" hidden></b>
  <i class="refused-mark" aria-hidden="true"></i>
`;
  // Hidden until a scene composing `discardBin` comes to the front (#183).
  discardArea.hidden = true;
  host.append(discardArea);
  return discardArea;
}

export function createTableInput(options: {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  discardArea: HTMLElement;
  rules: TableRules;
  cameraView: CameraViewService;
  hand: HandView;
  field: FieldView;
  /** Built after the input, so reached when a gesture happens. */
  overlays(): Overlays;
  audio: Pick<AudioService, "zoomed">;
  rack: RackDragTarget;
  cubeSize: number;
  setDragLayer: DragLayer;
  /** The selection changed (highlight it). */
  onSelectionChange(): void;
  /** Offer an event to the scene stack first; true when a scene consumed it. */
  routeToScenes(event: Event): boolean;
  /**
   * Developer tracing (the dev10 drop inspector): told each decision the input makes about a
   * drag or drop, and why. The game passes nothing; tracing never changes what happens.
   */
  trace?: (event: string, detail?: string) => void;
}): TableInput {
  const trace = options.trace ?? (() => {});
  const { host, canvas, discardArea, rules, cameraView, hand, field, rack, cubeSize } = options;
  const discardCount = discardArea.querySelector<HTMLElement>(".discard-count")!;

  // ----- Drop targets (#273): each owns its own decision; the drag hit-tests them by priority -----

  const dropTargetKinds = new Registry<DropTarget>("drop target");
  /**
   * The bin, a drop target: takes dropped hand blocks as a discard when discards are left,
   * rejects them (the red X, the denied sound) when none are. It shows its own hover feedback.
   */
  let discardHover: DropVerdict | null = null;
  dropTargetKinds.register("discard", {
    canDrop: (_carried, clientX, clientY) =>
      overDiscardArea(clientX, clientY) ? (rules.canDiscard() ? "accept" : "reject") : null,
    hover(verdict) {
      if (verdict === "accept" && discardHover !== "accept") playSfx("discard.hover");
      discardHover = verdict;
      discardArea.classList.toggle("is-target", verdict === "accept");
      discardArea.classList.toggle("is-refused", verdict === "reject");
    },
    drop: (carried) => rules.discard([...carried]),
    reject: () => options.overlays().flashRefused(discardArea),
    describe: (verdict) =>
      verdict === "accept" ? "the bin" : "none: over the bin with no discards left",
  });
  /**
   * Drag sources (#282): what can be picked up. The hand gives up the draggable block under the
   * pointer while the scene in front takes plays.
   */
  const dragSourceKinds = new Registry<DragSource>("drag source");
  dragSourceKinds.register("hand", {
    pick(clientX, clientY) {
      const source = pickBlock(clientX, clientY, reachableHand());
      return fieldActive && source && blockCanDrag(source.block) ? source : null;
    },
  });
  /**
   * dnd-kit (#282) runs the drag: its pointer sensor starts one only after the pointer moves
   * 8px (so a press released sooner is a click, which selects), captures the pointer, and
   * finishes on the release wherever it lands, so losing capture can't strand a drag (#267).
   * No plugins: the dragged blocks are 3D, and this service moves them.
   */
  const dnd = new DndKitManager({
    plugins: [],
    sensors: [
      PointerSensor.configure({
        // A fresh constraint per press: a constraint keeps that press's state (#282).
        activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 8 })],
        preventActivation: (event, draggable) =>
          !dragDrop.canStart(draggable, event.clientX, event.clientY),
      }),
    ],
  });
  const dragDrop = createDragDropManager(dropTargetKinds, dnd, {
    kinds: dragSourceKinds,
    surface: canvas,
  });
  let selected: Selection = new Set();
  /** Whether the scene in front lets blocks be played onto the field. */
  let fieldActive = false;
  let drag: Drag | null = null;
  /** Whether the board is being turned by a drag (use-gesture, #275). */
  let boardDragging = false;
  /** Whether two fingers are pinching (use-gesture, #275). */
  let pinching = false;
  let suppressClickUntil = 0;
  /** Touch has no hover: press and hold a block to read its inspection text. */
  const hold = createHoldGesture();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const awayFromCamera = new THREE.Vector3();
  const fanOffset = new THREE.Vector3();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const dragPoint = new THREE.Vector3();

  function showInspection(block: CardBlock | undefined, clientX: number, clientY: number): void {
    options.overlays().inspect((block && inspectBlock(block)) || null, clientX, clientY);
  }

  function pointRay(
    clientX: number,
    clientY: number,
    viewCamera: THREE.Camera = cameraView.camera,
  ): void {
    const bounds = canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, viewCamera);
  }

  function pickBlock(
    clientX: number,
    clientY: number,
    candidates: readonly RenderedBlock[],
  ): RenderedBlock | undefined {
    pointRay(
      clientX,
      clientY,
      candidates === hand.blocks ? cameraView.handCamera : cameraView.camera,
    );
    const hit = raycaster.intersectObjects(
      candidates.map(({ cube }) => cube),
      false,
    )[0];
    return candidates.find(({ cube }) => cube === hit?.object);
  }

  /** How many scenes in front compose `handView`; the hand takes input only while any does. */
  let handScenes = 0;
  /** The hand's blocks the pointer can reach: none while no scene in front shows the hand. */
  const reachableHand = () => (handScenes > 0 ? hand.blocks : []);

  const pickAny = (clientX: number, clientY: number) =>
    pickBlock(clientX, clientY, reachableHand()) ?? pickBlock(clientX, clientY, field.blocks());

  function overDiscardArea(clientX: number, clientY: number): boolean {
    const bounds = discardArea.getBoundingClientRect();
    return (
      clientX >= bounds.left &&
      clientX <= bounds.right &&
      clientY >= bounds.top &&
      clientY <= bounds.bottom
    );
  }

  function pickAttachment(clientX: number, clientY: number, count = 1): Candidate | null {
    if (field.occupiedCells().length === 0) {
      // The first play of a stage goes to the centre: drop anywhere above the hand.
      const bounds = host.getBoundingClientRect();
      const aboveHand = clientY < bounds.top + bounds.height * 0.72;
      const cells = rules.linePlacement(count);
      return aboveHand && cells ? { target: null, face: null, cell: cells[0], cells } : null;
    }
    pointRay(clientX, clientY);
    const hit = field.faceAt(raycaster);
    if (!hit) return null;
    const { target, face } = hit;
    // A line runs out from the face; it is refused whole if it would reach a block.
    const cells = rules.linePlacement(count, target.block.id, face);
    return cells ? { target, face, cell: cells[0], cells } : null;
  }

  /** The hand position under the pointer, or null when the pointer is not over the hand. */
  function handReorderSlot(clientX: number, clientY: number): number | null {
    const bounds = host.getBoundingClientRect();
    if (clientY < bounds.top + bounds.height * 0.72 || hand.blocks.length < 2) return null;
    pointRay(clientX, clientY, cameraView.handCamera);
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return null;
    return hand.slotAt(dragPoint.x);
  }

  function updateCandidate(): void {
    if (!drag?.active) return;
    const previousCell = drag.candidate ? cellKey(drag.candidate.cell) : null;
    // The drop targets a scene allows (#273) are hit-tested first, by priority; the first to
    // answer takes the point. The grid's placement is the fallback until it's a target (#274).
    drag.hit = dragDrop.hitTest([drag.source, ...drag.group], drag.lastX, drag.lastY);
    dragDrop.hover(drag.hit);
    const claimed = drag.hit !== null;
    // A group plays as a line (one play) or is discarded; it is not reordered as one.
    const single = drag.group.length === 0;
    drag.candidate =
      fieldActive && !claimed && rules.canPlay()
        ? pickAttachment(drag.lastX, drag.lastY, drag.group.length + 1)
        : null;
    field.showCandidate(drag.candidate);
    const previousSlot = drag.reorderSlot;
    drag.reorderSlot =
      single && !claimed && !drag.candidate ? handReorderSlot(drag.lastX, drag.lastY) : null;
    if (drag.reorderSlot !== previousSlot) hand.layout();
    if (drag.candidate && cellKey(drag.candidate.cell) !== previousCell) playSfx("card.drag.snap");
    // Tracing (dev10): each time the drop target changes, say where it is now, or why there's none.
    const target = drag.candidate
      ? `${drag.candidate.cells.length} cell${drag.candidate.cells.length === 1 ? "" : "s"} from ${
          drag.candidate.target ? `the ${drag.candidate.face} face of a block` : "the empty table"
        }`
      : drag.hit
        ? drag.hit.target.describe(drag.hit.verdict)
        : !fieldActive
          ? "none: this scene doesn't take plays"
          : !rules.canPlay()
            ? "none: no plays left"
            : drag.group.length > 0 && pickAttachment(drag.lastX, drag.lastY, 1)
              ? `none: a face is here, but no room for a ${drag.group.length + 1}-block line`
              : "none: not over a face that can take a block";
    if (target !== drag.tracedTarget) {
      drag.tracedTarget = target;
      trace("drop target", target);
    }
  }

  function moveDraggedBlock(): void {
    if (!drag?.active) return;
    pointRay(drag.lastX, drag.lastY, cameraView.handCamera);
    if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
      drag.source.cube.position.copy(dragPoint).add(drag.grabOffset);
      // Carried blocks trail the dragged one in a small fanned stack behind it.
      // Each is pushed a whole block further from the camera (straight back along its view,
      // so the fan on screen is unchanged) and never intersects the one in front.
      cameraView.handCamera.getWorldDirection(awayFromCamera);
      drag.group.forEach((rendered, index) => {
        const step = index + 1;
        rendered.cube.position
          .copy(drag!.source.cube.position)
          .add(fanOffset.set(0.28 * step, 0.22 * step, 0))
          .addScaledVector(awayFromCamera, cubeSize * step);
      });
    }
  }

  /** The blocks a drag plays, in the order they were selected (the dragged one alone if none). */
  function playOrder(activeDrag: Drag): RenderedBlock[] {
    if (!activeDrag.group.length) return [activeDrag.source];
    const carried = [activeDrag.source, ...activeDrag.group];
    return [...selected]
      .map((id) => carried.find(({ block }) => block.id === id))
      .filter((rendered): rendered is RenderedBlock => Boolean(rendered));
  }

  function finishDrag(drop: boolean): void {
    if (!drag) return;
    const activeDrag = drag;
    if (activeDrag.active) {
      if (drop) updateCandidate();
      const candidate = drop ? activeDrag.candidate : null;
      const hit = drop ? activeDrag.hit : null;
      drag = null;
      field.showCandidate(null);
      dragDrop.hover(null);
      if (hit?.verdict === "reject") hit.target.reject();
      cameraView.changeMotionRate(normalMotionRate);
      suppressClickUntil = performance.now() + 250;
      // Model first (#272): the drop commits now, even while earlier plays are still being
      // shown; their animations and this one catch up with the model.
      commitDrop(activeDrag, candidate, hit, drop);
    } else {
      drag = null;
    }
  }

  /**
   * Carry out a finished drag: play it at its candidate, discard it, reorder the hand, or put it
   * back. Every carried block ends up exactly once: played, discarded or back in the hand.
   */
  function commitDrop(
    activeDrag: Drag,
    candidate: Candidate | null,
    hit: DropHit | null,
    drop: boolean,
  ): void {
    const reorderSlot = drop ? activeDrag.reorderSlot : null;
    const carried = [activeDrag.source, ...activeDrag.group];
    for (const rendered of carried) options.setDragLayer(rendered.cube, false);
    // A drop target that accepted takes the blocks itself (#273); otherwise the grid's placement does.
    const delivered = hit?.verdict === "accept";
    const accepted = delivered
      ? hit.target.drop(carried)
      : candidate
        ? rules.play(playOrder(activeDrag), candidate)
        : false;
    const blocks = carried.length;
    trace(
      accepted
        ? delivered
          ? `dropped on ${hit.name}`
          : "played"
        : candidate || hit
          ? "refused"
          : "returned",
      `${blocks} block${blocks === 1 ? "" : "s"}${candidate ? " onto the field" : hit ? ` at ${hit.name}` : ""}`,
    );
    const from = rules.hand().indexOf(activeDrag.source.block);
    if (!accepted && reorderSlot !== null && reorderSlot !== from) {
      // A drop inside the hand reorders it: not a play or discard, and nothing refills.
      rules.reorderHand(from, reorderSlot);
      hand.putBack([activeDrag.source]);
      hand.sync(rules.hand());
      playSfx("hand.reorder");
    } else if (!accepted) {
      // A drop the rules refuse (or any drop with no plays left) is denied; a drop on
      // empty space just returns the block to the hand.
      const refused = drop && (hit !== null || candidate !== null || !rules.canPlay());
      playSfx(refused ? "action.denied" : "card.drag.return");
      hand.putBack([activeDrag.source, ...activeDrag.group]);
      hand.layout();
    }
  }

  // ----- The hand drag, run by dnd-kit (#282) -----

  /** Cancel the hand drag dnd-kit is running, if any; its dragend puts the blocks back. */
  function cancelHandDrag(reason: string): void {
    // A press still under dnd-kit's threshold is forgotten too, so it can't start a drag later
    // (behind the pause menu, say).
    dragDrop.forgetPresses();
    if (dnd.dragOperation.status.idle) return;
    trace("drag ended", reason);
    dnd.actions.stop({ canceled: true });
  }

  dnd.monitor.addEventListener("beforedragstart", (event) => {
    // A hold (inspect) or a second finger (a pinch) has already claimed this pointer.
    // A press that was cancelled (forgotten) never becomes a drag.
    const source = event.operation.source as Draggable | null;
    if (hold.holding || pinching || !source || !dragDrop.pressed(source)) event.preventDefault();
  });
  dnd.monitor.addEventListener("dragstart", ({ operation }) => {
    const activator = operation.activatorEvent as PointerEvent | null;
    const { x, y } = operation.position.current;
    const press = operation.source && dragDrop.pressed(operation.source as Draggable);
    if (!press) {
      dnd.actions.stop({ canceled: true });
      return;
    }
    const source = press.picked;
    // The grab is where the press went down on the block, not where the drag began.
    pointRay(press.clientX, press.clientY, cameraView.handCamera);
    const grabOffset = raycaster.ray.intersectPlane(dragPlane, dragPoint)
      ? source.cube.position.clone().sub(dragPoint)
      : new THREE.Vector3();
    // Dragging a selected block carries the rest of the hand selection with it.
    const group = selected.has(source.block.id)
      ? hand.selected(selected).filter((rendered) => rendered !== source)
      : [];
    drag = {
      source,
      grabOffset,
      pointerId: activator?.pointerId ?? -1,
      lastX: x,
      lastY: y,
      active: true,
      candidate: null,
      hit: null,
      group,
      reorderSlot: null,
    };
    const carried = group.length + 1;
    trace(
      "drag started",
      `carrying ${carried} block${carried === 1 ? "" : "s"}${carried > 1 ? " (the dragged one is selected, so the whole selection comes)" : ""}${rules.busy() ? ", while an animation is running" : ""}`,
    );
    for (const rendered of [source, ...group]) options.setDragLayer(rendered.cube, true);
    cameraView.changeMotionRate(normalMotionRate / 10);
    playSfx("card.pickup");
    options.overlays().hideTooltip();
    moveDraggedBlock();
    updateCandidate();
  });
  dnd.monitor.addEventListener("dragmove", ({ operation, to }) => {
    if (!drag?.active) return;
    const { x, y } = to ?? operation.position.current;
    drag.lastX = x;
    drag.lastY = y;
    options.overlays().hideTooltip();
    moveDraggedBlock();
    updateCandidate();
    canvas.style.cursor = "grabbing";
  });
  dnd.monitor.addEventListener("dragend", ({ operation, canceled, nativeEvent }) => {
    const release = nativeEvent as PointerEvent | undefined;
    // dnd-kit stops the release from reaching anything else, so use-gesture (#275), which saw
    // the press, would still think it held: tell it the pointer is up.
    const pressed = operation.activatorEvent as PointerEvent | null;
    if (pressed) {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: pressed.pointerId,
          pointerType: pressed.pointerType,
          isPrimary: pressed.isPrimary,
          clientX: release?.clientX ?? pressed.clientX,
          clientY: release?.clientY ?? pressed.clientY,
        }),
      );
    }
    window.clearTimeout(releaseGrace);
    if (!drag?.active) return;
    if (release && !canceled) {
      drag.lastX = release.clientX;
      drag.lastY = release.clientY;
      moveDraggedBlock();
    }
    if (!canceled) trace("drag ended", "button released");
    finishDrag(!canceled);
    canvas.style.cursor = "default";
  });

  /** How long a hand drag that lost its capture waits for its release before it is cancelled. */
  const releaseGraceMs = 250;
  let releaseGrace = 0;
  /**
   * dnd-kit captures a dragged pointer on the body and finishes on its release wherever it
   * lands, but nothing ends the drag if capture is lost and no release or cancel ever comes.
   * A release usually follows within milliseconds (#267), so wait briefly, then cancel.
   */
  const onBodyLostCapture = (event: PointerEvent) => {
    // Only the body's own loss counts: the canvas losing a touch's capture to the body (as
    // dnd-kit takes it) bubbles up here too, and that drag is very much alive.
    if (event.target !== document.body) return;
    if (!drag?.active || drag.pointerId !== event.pointerId) return;
    trace("pointer capture lost", "mid-drag: waiting for the release");
    const waiting = drag;
    window.clearTimeout(releaseGrace);
    releaseGrace = window.setTimeout(() => {
      if (drag !== waiting) return;
      cancelHandDrag(`no release ${releaseGraceMs}ms after capture was lost: cancelled`);
    }, releaseGraceMs);
  };
  document.body.addEventListener("lostpointercapture", onBodyLostCapture);

  // ----- Board gestures, run by use-gesture (#275) -----

  /**
   * Turning, pinching and wheeling the board. A board drag claims a pointer only where it
   * presses the structure and no drag source (dnd-kit's) picks anything up; a pinch cancels a
   * hand drag or a hold, since a second finger changes the gesture.
   */
  /**
   * End a board drag now: its release may never come (focus lost, a menu opened) or a pinch
   * takes the pointer over. Later moves of that drag are ignored.
   */
  function endBoardDrag(reason: string): void {
    if (!boardDragging) return;
    trace("board drag", `ended: ${reason}`);
    boardDragging = false;
    cameraView.changeMotionRate(normalMotionRate);
    suppressClickUntil = performance.now() + 250;
    canvas.style.cursor = "default";
  }

  function bindBoardGestures(): () => void {
    /** Radians per pixel of twist, matched to `rotateBy`'s 0.005 per pixel of drag. */
    const twistPixelsPerDegree = Math.PI / 180 / 0.005;
    const gesture = new Gesture(
      canvas,
      {
        onDrag: ({
          first,
          last,
          initial: [x0, y0],
          delta: [dx, dy],
          cancel,
          touches: fingers,
          buttons,
        }) => {
          if (first) {
            const claims =
              buttons !== 0 &&
              fingers <= 1 &&
              !pinching &&
              !hold.holding &&
              !dragDrop.pickUp(x0, y0) &&
              Boolean(pickBlock(x0, y0, field.blocks()));
            if (!claims) {
              trace("board drag", "not claimed: not on the structure, or a drag source has it");
              return cancel();
            }
            trace("board drag", "turning the structure");
            boardDragging = true;
            cameraView.changeMotionRate(0);
            options.overlays().hideTooltip();
          }
          if (!boardDragging) return;
          cameraView.rotateBy(dx, dy);
          canvas.style.cursor = "grabbing";
          if (last) endBoardDrag("released");
        },
        onPinch: ({ first, last, da: [distance, angle], memo }) => {
          const start = (memo ?? { zoom: cameraView.zoom, distance, angle }) as {
            zoom: number;
            distance: number;
            angle: number;
          };
          if (first) {
            trace("pinch", "started: zooming and twisting the board");
            pinching = true;
            endBoardDrag("a second finger touched (a pinch)");
            hold.cancel();
            cancelHandDrag("a second finger touched (a pinch)");
            options.audio.zoomed();
          }
          cameraView.zoomWithPinch(start.zoom, start.distance, distance);
          cameraView.rotateBy((angle - start.angle) * twistPixelsPerDegree, 0);
          suppressClickUntil = performance.now() + 400;
          if (last) {
            trace("pinch", `ended at zoom ${cameraView.zoom.toFixed(2)}`);
            pinching = false;
          }
          return { ...start, angle };
        },
        onWheel: ({ event }) => {
          if (options.overlays().isOpen) return;
          event.preventDefault();
          cameraView.zoomWithWheel(event.deltaY, event.deltaMode);
          trace("wheel", `zoom ${cameraView.zoom.toFixed(2)}`);
          options.audio.zoomed();
        },
      },
      {
        drag: { threshold: 8, filterTaps: true, pointer: { capture: false } },
        wheel: { eventOptions: { passive: false } },
      },
    );
    return () => {
      gesture.destroy();
      endBoardDrag("the board's scene left");
      pinching = false;
    };
  }

  // ----- Hand cards and the board -----

  const onPointerDown = (event: PointerEvent) => {
    // A card can be picked up at any time, while earlier plays are still being shown (#167,
    // #272): input always commits to the model at once.
    // Touch has no hover: a finger held still inspects instead (a pinch cancels it).
    if (event.pointerType === "touch" && !pinching) startHold(event);
    options.overlays().hideTooltip();
    const source = pickBlock(event.clientX, event.clientY, reachableHand());
    const pickedUp = dragDrop.pickUp(event.clientX, event.clientY);
    trace(
      "pointer down",
      pickedUp
        ? "on a hand block: can drag"
        : !source
          ? "on no hand block"
          : !fieldActive
            ? "on a hand block, but this scene doesn't take plays"
            : "on a hand block that can't be dragged",
    );
    // A drag source's pointer belongs to dnd-kit, which starts the drag once it moves (#282);
    // turning the board is use-gesture's (#275).
  };

  const onPointerMove = (event: PointerEvent) => {
    hold.move(event.pointerId, event.clientX, event.clientY);
    if (hold.holding) return;
    if (boardDragging || pinching) return;
    const hovered = pickAny(event.clientX, event.clientY);
    canvas.style.cursor = blockCursor(hovered?.block);
    showInspection(
      event.pointerType === "touch" ? undefined : hovered?.block,
      event.clientX,
      event.clientY,
    );
  };

  const onPointerLeave = () => {
    options.overlays().hideTooltip();
    canvas.style.cursor = "default";
  };

  const onPointerUp = (event: PointerEvent) => {
    if (hold.up(event.pointerId)) {
      // A hold only inspects: lifting it neither taps, plays nor rotates.
      options.overlays().hideTooltip();
      suppressClickUntil = performance.now() + 400;
      return;
    }
    if (pinching) return;
    const wasDragging = Boolean(drag?.active || boardDragging);
    canvas.style.cursor = "default";
    const hovered = pickAny(event.clientX, event.clientY);
    showInspection(
      wasDragging || event.pointerType === "touch" ? undefined : hovered?.block,
      event.clientX,
      event.clientY,
    );
  };

  const onPointerCancel = () => {
    hold.cancel();
    options.overlays().hideTooltip();
    canvas.style.cursor = "default";
  };

  /** Start a hold on the block under a finger; when it holds, inspect instead of dragging. */
  function startHold(event: PointerEvent): void {
    const target = pickAny(event.clientX, event.clientY);
    if (!target) return;
    const { pointerId, clientX, clientY } = event;
    hold.down(pointerId, clientX, clientY, () => {
      cancelHandDrag("held still: inspect");
      // Above the finger, so the label never sits under it or over the card.
      showInspection(target.block, clientX, clientY - holdLabelLift);
    });
  }

  /** The app was hidden or lost focus mid-gesture: nothing completes. */
  const onVisibilityChange = () => {
    if (document.hidden) onBlur();
  };

  const onClick = (event: MouseEvent) => {
    if (performance.now() < suppressClickUntil) return;
    const target = pickAny(event.clientX, event.clientY);
    if (!target) return;
    const wasSelected = selected.has(target.block.id);
    selected = toggleBlockSelection(selected, target.block);
    const isSelected = selected.has(target.block.id);
    if (isSelected !== wasSelected) playSfx(isSelected ? "card.select" : "card.deselect");
    options.onSelectionChange();
    refreshDiscardTarget();
  };

  const onBlur = () => {
    hold.cancel();
    options.overlays().hideTooltip();
    cancelHandDrag("the window lost focus");
    endBoardDrag("the window lost focus");
    pinching = false;
  };

  // ----- The discard (and sell) target -----

  /** The bin's badge: how many selected hand blocks a click would discard. */
  function refreshDiscardTarget(): void {
    const canDiscard = rules.canDiscard();
    discardArea.classList.toggle("is-exhausted", !canDiscard);
    const count = rules.inStage() && canDiscard ? hand.selected(selected).length : 0;
    discardCount.hidden = count === 0;
    discardCount.textContent = String(count);
    discardArea.classList.toggle("is-armed", count > 0);
  }

  /** Click or tap the bin: discard the selected hand blocks as one discard. */
  const onDiscardClick = () => {
    // While it reads Sell (a passive is being dragged) the target never discards.
    if (passiveDrag || discardArea.classList.contains("is-sell")) return;
    // Model first (#272): a discard commits at once, even while earlier plays are shown.
    if (drag?.active || !rules.inStage()) {
      trace("discard ignored", drag?.active ? "a drag is active" : "not in a stage");
      return;
    }
    const chosen = hand.selected(selected);
    if (!chosen.length) return;
    if (!rules.canDiscard() || !rules.discard(chosen)) {
      options.overlays().flashRefused(discardArea);
      playSfx("action.denied");
    }
  };

  // ----- Selling or reordering a passive (issue #16): drag it from the rack -----

  /** A passive picked up from the rack; it becomes a drag once the pointer moves a little. */
  let passiveDrag: {
    block: PassiveBlock;
    pointerId: number;
    startX: number;
    startY: number;
    floating: HTMLElement | null;
    /** The rack slot a drop would move it to, while the pointer is over the rack. */
    slot: number | null;
  } | null = null;

  /** The shared lower-screen target reads Sell in the shop or while a passive is dragged. */
  function showSellTarget(selling: boolean): void {
    const showSell = selling || sellBinScenes > 0;
    discardArea.classList.toggle("is-sell", showSell);
    discardArea.setAttribute("aria-label", showSell ? "Sell area" : "Discard area");
    discardArea.querySelector(".discard-label")!.textContent = showSell ? "SELL" : "DISCARD";
    if (!selling) discardArea.classList.remove("is-target", "is-refused");
  }

  function movePassive(event: PointerEvent): void {
    if (!passiveDrag || event.pointerId !== passiveDrag.pointerId) return;
    if (!passiveDrag.floating) {
      if (Math.hypot(event.clientX - passiveDrag.startX, event.clientY - passiveDrag.startY) < 6)
        return;
      // A real drag: lift the cube out of the rack and show a token under the pointer.
      const appearance = passiveAppearance(passiveDrag.block);
      const floating = document.createElement("div");
      floating.className = "passive-floating";
      floating.textContent = appearance.symbol;
      floating.style.background = appearance.palette.face;
      floating.style.color = appearance.palette.ink;
      floating.style.borderColor = appearance.palette.edge;
      document.body.append(floating);
      passiveDrag.floating = floating;
      rack.lift(passiveDrag.block.id);
      showSellTarget(true);
      playSfx("passive.pickup");
    }
    passiveDrag.floating.style.left = `${event.clientX}px`;
    passiveDrag.floating.style.top = `${event.clientY}px`;
    // Over the rack, preview the reorder: neighbours glide aside to open the drop slot.
    const slot = rack.slotAt(event.clientX, event.clientY) ?? null;
    if (slot !== passiveDrag.slot) {
      passiveDrag.slot = slot;
      const ids = rules.passiveRack().map(({ id }) => id);
      const from = ids.indexOf(passiveDrag.block.id);
      rack.preview(slot === null || from < 0 ? null : moveItem(ids, from, slot));
    }
    const over = overDiscardArea(event.clientX, event.clientY);
    const canSell = rules.canSellPassives();
    const wasTarget = discardArea.classList.contains("is-target");
    discardArea.classList.toggle("is-target", over && canSell);
    discardArea.classList.toggle("is-refused", over && !canSell);
    if (over && canSell && !wasTarget) playSfx("discard.hover");
  }

  function dropPassive(event: PointerEvent, cancelled: boolean): void {
    if (!passiveDrag || event.pointerId !== passiveDrag.pointerId) return;
    const { block, floating, slot } = passiveDrag;
    passiveDrag = null;
    if (!floating) return; // a click, not a drag: the rack's tooltip handles that
    floating.remove();
    showSellTarget(false);
    rack.lift(null);
    rack.preview(null);
    // A drop inside the rack reorders it: not a sale, and nothing else changes.
    const from = rules.passiveRack().findIndex(({ id }) => id === block.id);
    if (!cancelled && slot !== null && from >= 0) {
      if (slot !== from && rules.reorderPassive(from, slot)) playSfx("hand.reorder");
      else playSfx("card.drag.return");
      return;
    }
    if (cancelled || !overDiscardArea(event.clientX, event.clientY)) {
      playSfx("card.drag.return");
      return;
    }
    if (!rules.canSellPassives() || !rules.sellPassive(block.id)) {
      options.overlays().flashRefused(discardArea);
      playSfx("action.denied");
      return;
    }
    playSfx("reward.coin");
  }
  const onPassiveUp = (event: PointerEvent) => dropPassive(event, false);
  const onPassiveCancel = (event: PointerEvent) => dropPassive(event, true);

  // ----- Wiring -----

  const routeSceneInput = (event: Event) => {
    if (!options.routeToScenes(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Pointer input inside the host is routed to the scenes during capture. Keys go to the scenes
  // from the window, after bubbling, so a focused field or the open developer console (which
  // stops the keys it uses) handles them first (#87).
  const sceneInputEvents = [
    "pointerdown",
    "pointerup",
    "pointercancel",
    "click",
    "dblclick",
    "wheel",
  ];
  const canvasListeners: [string, (event: never) => void, AddEventListenerOptions?][] = [
    ["pointerdown", onPointerDown],
    ["pointermove", onPointerMove],
    ["pointerleave", onPointerLeave],
    ["pointerup", onPointerUp],
    ["pointercancel", onPointerCancel],
    ["click", onClick],
  ];
  window.addEventListener("pointermove", movePassive);
  window.addEventListener("pointerup", onPassiveUp);
  window.addEventListener("pointercancel", onPassiveCancel);
  discardArea.addEventListener("click", onDiscardClick);
  for (const type of sceneInputEvents) host.addEventListener(type, routeSceneInput, true);
  window.addEventListener("keydown", routeSceneInput);
  for (const [type, listener, listenerOptions] of canvasListeners)
    canvas.addEventListener(type, listener as EventListener, listenerOptions);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);

  /** How many scenes in front compose `discardBin`; the bin is shown while any does. */
  let discardBinScenes = 0;
  let sellBinScenes = 0;

  return {
    handEntered(entered) {
      handScenes = Math.max(0, handScenes + (entered ? 1 : -1));
    },
    enableDropTarget: (config) => dragDrop.enable(config),
    enableDragSource: (config) => dragDrop.enableSource(config),
    enableBoardGestures: bindBoardGestures,
    discardBinEntered(entered) {
      discardBinScenes = Math.max(0, discardBinScenes + (entered ? 1 : -1));
      discardArea.hidden = discardBinScenes + sellBinScenes === 0;
    },
    sellBinEntered(entered) {
      sellBinScenes = Math.max(0, sellBinScenes + (entered ? 1 : -1));
      discardArea.hidden = discardBinScenes + sellBinScenes === 0;
      showSellTarget(false);
    },
    fieldBlockAt: (clientX, clientY) => pickBlock(clientX, clientY, field.blocks())?.block.id,
    get selection() {
      return selected;
    },
    deselect(ids) {
      const gone = new Set(ids);
      selected = new Set([...selected].filter((id) => !gone.has(id)));
    },
    clearSelection() {
      selected = new Set();
    },
    handDrag: () => (drag?.active ? drag : null),
    get dragging() {
      return Boolean(drag?.active);
    },
    get candidateCell() {
      return drag?.active ? (drag.candidate?.cell ?? null) : null;
    },
    setFieldActive(active) {
      fieldActive = active;
    },
    cancelGestures() {
      onBlur();
      const lifted = passiveDrag;
      if (lifted) dropPassive({ pointerId: lifted.pointerId } as PointerEvent, true);
    },
    pickUpPassive(block, event) {
      // Only the primary pointer's main button picks a passive up.
      if (passiveDrag || drag || !event.isPrimary || event.button !== 0) return;
      passiveDrag = {
        block,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        floating: null,
        slot: null,
      };
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    refreshDiscardTarget,
    frame() {
      if (drag?.active) updateCandidate();
    },
    dispose() {
      window.removeEventListener("pointermove", movePassive);
      window.removeEventListener("pointerup", onPassiveUp);
      window.removeEventListener("pointercancel", onPassiveCancel);
      window.removeEventListener("keydown", routeSceneInput);
      discardArea.removeEventListener("click", onDiscardClick);
      for (const type of sceneInputEvents) host.removeEventListener(type, routeSceneInput, true);
      for (const [type, listener] of canvasListeners)
        canvas.removeEventListener(type, listener as EventListener);
      window.removeEventListener("blur", onBlur);
      dnd.destroy();
      window.clearTimeout(releaseGrace);
      document.body.removeEventListener("lostpointercapture", onBodyLostCapture);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
