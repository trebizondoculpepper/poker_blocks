import type { CardBlock } from "./cards";
import { cellKey } from "./traits/attachable";
/**
 * Play presenter service: shows a play or discard the rules have already accepted. Played
 * blocks fly from the hand to their cells one after another (a transparent block dissolves
 * into its table version as it lands); discarded blocks dissolve away. Then the scoring
 * lines are presented, lowest first, each tinting its row and adding its points to the
 * score shown, before the stage's outcome is announced.
 *
 * While a play or its scoring is being presented the HUD hides the outcome and the table
 * takes no new gestures.
 */
import { landingSounds } from "./attachment-sound";
import { getMaterialDefinition, materialOf } from "./materials";
import * as THREE from "three";
import { playSfx } from "./audio/sfx";
import type { CameraViewService } from "./camera-view";
import { roundOutcome, type RoundOutcome } from "./dealer";
import { tweenValue } from "./easing";
import { tintSeconds, type Candidate, type FieldView } from "./field-view";
import type { GameRun } from "./game-run";
import type { HandView } from "./hand-view";
import type { BlockViews, RenderedBlock } from "./rendered-blocks";
import { magnitudeSfxFor } from "./score-presentation";
import { presentationOrder } from "./scoring";
import type { PassiveScoredLine, RuleActivation } from "./passive-effects";
import type { Cell } from "./traits/attachable";
import { needsLandingHandover } from "./block-trait-behaviours";
import { createMaterialise } from "./visual/materialise";
import {
  createScoreNarration,
  type NarratedEndpoint,
  type AlongsideEvent,
  type NarratedLine,
  type NarrationSlot,
  type ScoreNarrationSink,
} from "./score-narration";
import {
  unitMs,
  visualHandlers,
  type EffectHandle,
  type ScopeHandle,
  type VisualScheduler,
} from "./visual-events/scheduler";

/**
 * A committed play's or discard's animation, run as an effect on the shared visual-event
 * scheduler (#548; doc/visual-event-interface.md, "Migration order and acceptance", step 3). Its
 * meshes stay with the presenter that captured them; the event's payload names it by an opaque id.
 */
export type PresentedAction = {
  /** Advance to `elapsed` seconds after it started, by `delta`: true while it still runs. */
  step(elapsed: number, delta: number): boolean;
  /** Stop without completing it (a reset or a scene exit): release what it holds. */
  cancel(): void;
};

/** The presenter's actions, as the scheduler's `presentedActions` service. */
export type PresentedActionServices = {
  presentedActions: { take(id: number): PresentedAction | null };
};

/** The longest step one frame advances an action: the frame loop's own clamp. */
const maxStepSeconds = 0.05;

visualHandlers.register("presenter.action", (payload, context): "done" | EffectHandle => {
  const { id } = payload as { id: number };
  const action = (context.services as PresentedActionServices).presentedActions.take(id);
  if (!action) return "done";
  let last = context.nowMs;
  let live = true;
  return {
    update(nowMs) {
      if (!live) return "finished";
      const delta = Math.min(Math.max(0, (nowMs - last) / 1000), maxStepSeconds);
      last = nowMs;
      live = action.step((nowMs - context.scheduledAtMs) / 1000, delta);
      return live ? "running" : "finished";
    },
    cancel() {
      if (!live) return;
      live = false;
      action.cancel();
    },
    dispose() {
      live = false;
    },
  };
});

type Materialise = ReturnType<typeof createMaterialise>;

/** One block flying from the hand to its cell. */
type Flight = {
  source: RenderedBlock;
  cell: Cell;
  /** Seconds after the play starts that this block sets off (a line goes one by one). */
  delay: number;
  fromPosition: THREE.Vector3;
  fromRotation: THREE.Quaternion;
  fromScale: number;
  /**
   * The table's version of the block, waiting in its cell. As the flying block lands it
   * dissolves away while this one dissolves in (transparent blocks only).
   */
  target: RenderedBlock | null;
  handedOver: boolean;
};

/** A play being shown. */
type Playing = {
  /** One flight per block played: a single block, or a line in selection order. */
  flights: Flight[];
  /** This play's scored lines, captured when it committed: later plays may commit first. */
  lines: readonly PassiveScoredLine[];
  /** Where this play left the stage when it committed: its score and outcome (#547). */
  endpoint: NarratedEndpoint;
  /** Its place in narration order, reserved when it committed (#800 review). */
  slot: NarrationSlot;
  /** Every running dissolve, for clean-up. */
  effects: Materialise[];
  /** The replacements the model drew when this play committed, shown once it has landed. */
  drawn: readonly CardBlock[];
};

/** A discard being shown. */
type Discarding = {
  sources: RenderedBlock[];
  effects: Materialise[];
  /** The replacements the model drew when this discard committed, shown once it has dissolved. */
  drawn: readonly CardBlock[];
};

export type PlayPresenter = {
  /** A play or discard is still animating. */
  readonly busy: boolean;
  /** A play is landing or its score is being presented: outcomes stay hidden. */
  readonly presenting: boolean;
  /** The score shown, which lags the state until the placed card lands. */
  readonly shownScore: number;
  /** Play blocks (in this order) at a candidate; false when the rules refuse. */
  play(sources: readonly RenderedBlock[], candidate: Candidate): boolean;
  /** Discard blocks as one discard; false when the rules refuse. */
  discard(sources: readonly RenderedBlock[]): boolean;
  /** Advance per-frame presentation (hand draw-ins); plays and discards run on the scheduler. */
  update(now: number, delta: number): void;
  /**
   * Where the shared visual-event scheduler finds the plays and discards it runs (#548): its
   * `presenter.action` handler reaches it as the `presentedActions` service.
   */
  readonly presentedActions: PresentedActionServices["presentedActions"];
  /**
   * Where the shared visual-event scheduler shows score narration (#547): its handlers reach it
   * as the `scoreNarration` service.
   */
  readonly narration: ScoreNarrationSink;
  /** Stop presenting: the score shown jumps to the run's (a new run, a forced outcome). */
  reset(): void;
  dispose(): void;
};

/** Score narration timing, in game-time units: 4.8 units is the 320 ms between lines. */
const narrationTiming = { lineStep: 4.8, settle: tintSeconds * 15 };
/** Seconds between the blocks of a line setting off. */
const lineStagger = 0.12;
/** Seconds into a play when the flight has reached its cell and the handover starts. */
const handoverAt = 1;
/** Seconds the handover dissolve takes. */
const handoverSeconds = 0.55;

/**
 * Transparent blocks (the trait) hand over with a dissolve once they land, from their hand
 * preview to their table version; opaque blocks just land.
 */
function needsHandover(rendered: RenderedBlock): boolean {
  return needsLandingHandover(rendered.block);
}

export function createPlayPresenter(options: {
  game(): GameRun;
  views: BlockViews;
  hand: HandView;
  field: FieldView;
  cameraView: CameraViewService;
  /** The board scene and assembly a flying block crosses into. */
  scene: THREE.Object3D;
  assembly: THREE.Object3D;
  reducedMotion(): boolean;
  /** Blocks left the hand: drop them from the selection. */
  deselect(ids: Iterable<string>): void;
  /** Something the HUD shows changed. */
  changed(): void;
  /** Blocks moved between hand and table: refresh the selection highlight. */
  moved(): void;
  /** The passive rack may have changed (a discard can grant passives). */
  rackChanged(): void;
  /** These rule sources' rules just fired, as their outcome is shown (#81). */
  activated(sourceIds: readonly string[]): void;
  /**
   * What the activation's host shows alongside its scored line (#919), captured as the play
   * commits: an item's activation label, or null when the host shows nothing for it.
   */
  alongside?(activation: RuleActivation): AlongsideEvent | null;
  /** Draw replacements into the model now, unshown (#775); returns them for a later reveal. */
  drawReplacements(): readonly CardBlock[];
  /** A safe point to save the run. */
  save(): void;
  /** The stage's outcome has been announced. */
  decided(outcome: RoundOutcome, now: number): void;
  /** The shared visual-event scheduler score narration is queued on (#547). */
  visualEvents: VisualScheduler;
}): PlayPresenter {
  const { views, hand, field, cameraView } = options;
  const game = () => options.game();
  /**
   * Plays and discards being shown (#272, model first): each committed to the model the moment
   * the player made it, and its animation catches up. Several can be in flight at once.
   */
  let playing: Playing[] = [];
  let discarding: Discarding[] = [];
  /** Actions committed and waiting for their effect to start, by the id their event carries. */
  const waiting = new Map<number, PresentedAction>();
  /** Each running action's scope, until it settles or a reset cancels it. */
  const actionScopes = new Set<ScopeHandle>();
  let nextActionId = 0;
  /** While a reset cancels every action: they are dropped, not completed. */
  let resetting = false;

  /**
   * Run an action's animation on the shared scheduler, from now, in a scope of its own: plays and
   * discards overlap freely and never wait for one another. Not admitted, it completes at once.
   */
  function present(action: PresentedAction): void {
    const events = options.visualEvents;
    const id = ++nextActionId;
    waiting.set(id, action);
    const scope = events.createScope(null);
    const admitted = events.schedule(scope, {
      handler: "presenter.action",
      payload: { id },
      dueUnits: events.nowMs / unitMs,
    });
    if (!admitted.accepted) {
      events.cancel(scope);
      waiting.delete(id);
      action.step(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
      return;
    }
    actionScopes.add(scope);
    events.seal(scope);
    events.observe(scope, () => actionScopes.delete(scope));
  }
  let shownScore = game().state.round.score;
  /** The latest frame's time, which tints and pulses started by narration are timed from. */
  let frameNow = 0;
  const placementTarget = new THREE.Vector3();
  const placementRotation = new THREE.Quaternion();

  /** What narration shows through, each line as it was captured when its play committed. */
  const sink: ScoreNarrationSink = {
    line({ blockIds, sourceIds, points }, lateMs) {
      // Started as of its scheduled time, so its tint has settled when the outcome shows.
      const startedAt = frameNow - lateMs;
      field.tint(blockIds, startedAt);
      options.activated(sourceIds);
      field.activate(sourceIds, startedAt);
      const sound = magnitudeSfxFor(points);
      if (sound) playSfx(sound, { jitter: 0 });
      shownScore += points;
      options.changed();
    },
    summarise({ score }) {
      shownScore = score;
      options.changed();
    },
    decide({ score, outcome }) {
      shownScore = score;
      options.decided(outcome, frameNow);
      options.changed();
    },
  };
  const narration = createScoreNarration(options.visualEvents, sink, narrationTiming, () =>
    options.changed(),
  );

  /**
   * Narrate the lines from the play that just landed, lowest score first, after any play still
   * being narrated: captured now, as plain data, so a later play can't change them.
   */
  function announceScore(action: Playing): void {
    narration.release(action.slot, {
      lines: presentationOrder(action.lines).map((line) =>
        capturedLine(line, (activation) => options.alongside?.(activation) ?? null),
      ),
      endpoint: action.endpoint,
    });
  }

  /** Advance a play's flights: true while it still runs, false once it has landed. */
  function updatePlay(action: Playing, elapsed: number, delta: number): boolean {
    const reduced = options.reducedMotion();
    for (const flight of action.flights) {
      const flying = elapsed - flight.delay;
      const progress = tweenValue(0, 1, Math.max(0, flying), 1);
      field.cellPosition(flight.cell, placementTarget);
      flight.source.cube.position.lerpVectors(flight.fromPosition, placementTarget, progress);
      flight.source.cube.quaternion.copy(flight.fromRotation).slerp(placementRotation, progress);
      flight.source.cube.scale.setScalar(THREE.MathUtils.lerp(flight.fromScale, 3, progress));
      // Landed: the flying preview burns away as the table's version burns in, in place.
      if (flight.target && !flight.handedOver && flying >= handoverAt) {
        flight.handedOver = true;
        for (const cube of [flight.source.cube, flight.target.cube]) {
          cube.children.forEach((edge) => (edge.visible = false));
          cube.updateWorldMatrix(true, true);
        }
        flight.target.cube.visible = true;
        action.effects.push(
          // The preview gives way exactly where the table's version arrives: the same
          // noise, so every point shows one or the other, never neither.
          createMaterialise(flight.source.cube, {
            seconds: handoverSeconds,
            replaced: true,
            reduced,
          }),
          createMaterialise(flight.target.cube, { seconds: handoverSeconds, reduced }),
        );
      }
    }
    action.effects.forEach((effect) => effect.update(delta));
    // A play lasts until its last block has landed (and handed over, if it does).
    const lasts = Math.max(
      ...action.flights.map(
        ({ delay, target }) => delay + (target ? handoverAt + handoverSeconds + 0.05 : 1),
      ),
    );
    if (elapsed < lasts) return true;
    playing = playing.filter((other) => other !== action);
    action.effects.forEach((effect) => effect.finish());
    for (const flight of action.flights) {
      if (flight.target) {
        views.dispose(flight.source);
        flight.target.cube.visible = true;
        flight.target.cube.children.forEach((edge) => (edge.visible = true));
        field.adopt(flight.target, flight.cell);
      } else {
        // Same look in hand and on the table: the flying block simply stays.
        field.adopt(flight.source, flight.cell);
      }
    }
    // A block changed while it flew (a transmogrifier dropped on it mid-flight, #389) lands as
    // the model has it now, and one removed while it flew (the Nothingifier, #156) doesn't
    // stay: model first, presentation catches up.
    for (const flight of action.flights) {
      const shown = field
        .blocks()
        .find(({ cell }) => cell && cellKey(cell) === cellKey(flight.cell));
      const now = game().state.field.find(({ cell }) => cellKey(cell) === cellKey(flight.cell));
      if (shown && now?.block !== shown.block) {
        field.remove(shown.block.id);
        if (now) field.add(now.block, now.cell);
      }
    }
    options.moved();
    // The softer material where each block meets the structure decides its sound (#232).
    const placed = game().state.field;
    const landed = action.flights.flatMap(
      (flight) => placed.find(({ block }) => block.id === flight.source.block.id) ?? [],
    );
    for (const id of landingSounds(landed, placed, (block) =>
      getMaterialDefinition(materialOf(block)),
    ))
      playSfx(id);
    announceScore(action);
    cameraView.scheduleCameraMove();
    // Model first: its replacements were drawn when it committed; only their reveal waits.
    hand.drawIn(action.drawn, game().state.hand);
    options.save();
    return false;
  }

  /** Advance a discard's dissolves: true while they run, false once its replacements show. */
  function updateDiscard(action: Discarding, delta: number): boolean {
    // Finished when its own dissolves have (#775): their clock, not a wall-clock second, so
    // reduced motion's short fade doesn't wait and a slow frame can't reveal replacements early.
    const running = action.effects.map((effect) => effect.update(delta));
    if (running.some(Boolean)) return true;
    discarding = discarding.filter((other) => other !== action);
    action.sources.forEach((source) => views.dispose(source));
    // Only this discard's own replacements, drawn when it committed: another action finishing
    // can't reveal them, and they can't reveal another's.
    hand.drawIn(action.drawn, game().state.hand);
    options.save();
    return false;
  }

  return {
    get busy() {
      return playing.length > 0 || discarding.length > 0;
    },
    get presenting() {
      return playing.length > 0 || narration.presenting;
    },
    get shownScore() {
      return shownScore;
    },
    play(sources, candidate) {
      const ids = sources.map(({ block }) => block.id);
      const next = game().play({
        cardId: ids[0],
        cardIds: ids,
        targetId: candidate.target?.block.id,
        face: candidate.face ?? undefined,
      });
      if (!next) return false;
      // Reactions (#366, #367) changed blocks already on the table, or made new ones (#425):
      // model first, so draw each now as the model has it, and play each reaction's sound. A
      // reacted block still landing is drawn as the model has it when it lands.
      // A block on screen is redrawn; one not on screen is added only if nothing is in or
      // expected in its cell (a new block), so a card still in flight lands as before.
      const landingIds = new Set(ids);
      const known = new Set(field.occupiedCells().map(cellKey));
      for (const { blockId } of game().lastReactions) {
        const now = next.field.find(({ block }) => block.id === blockId);
        if (!now || landingIds.has(blockId)) continue;
        const shown = field.blocks().some(({ block }) => block.id === blockId);
        if (!shown && known.has(cellKey(now.cell))) continue;
        if (shown) field.remove(blockId);
        field.add(now.block, now.cell);
      }
      for (const sound of new Set(
        game().lastReactions.flatMap(({ sound }) => [sound ?? []].flat()),
      ))
        playSfx(sound);
      hand.settle(sources);
      // The cards just played, wherever reactions left them in the field's order.
      const landed = next.field.filter(({ block }) => landingIds.has(block.id));
      // The field knows these cells now, so a drop made before they land is tested against them.
      for (const { block, cell } of landed) field.expect(block, cell);
      options.deselect(ids);
      hand.remove(sources);
      hand.sync(game().state.hand);
      // Model first (#775, #1033 review): the play's replacements are drawn as it commits, so no
      // presentation timing or cancellation decides whether they enter the hand.
      const drawn = options.drawReplacements();
      hand.sync(game().state.hand);
      // The cameras use different projections. Match each hand cube's screen position and
      // apparent size in the board view, then let the assembly carry it as it wobbles.
      cameraView.handCamera.updateWorldMatrix(true, false);
      cameraView.camera.updateWorldMatrix(true, false);
      const forward = cameraView.camera.getWorldDirection(new THREE.Vector3());
      const depth =
        (cameraView.handCamera.top - cameraView.handCamera.bottom) /
        (2 * Math.tan(THREE.MathUtils.degToRad(cameraView.camera.fov) / 2));
      const boardRay = new THREE.Raycaster();
      const flights = sources.map((source, index): Flight => {
        const { block, cell } = landed[index];
        source.block = block;
        source.cube.updateWorldMatrix(true, false);
        const screenPosition = source.cube
          .getWorldPosition(new THREE.Vector3())
          .project(cameraView.handCamera);
        boardRay.setFromCamera(
          new THREE.Vector2(screenPosition.x, screenPosition.y),
          cameraView.camera,
        );
        const boardPosition = boardRay.ray.at(
          depth / boardRay.ray.direction.dot(forward),
          new THREE.Vector3(),
        );
        options.scene.add(source.cube);
        source.cube.position.copy(boardPosition);
        options.assembly.attach(source.cube);
        return {
          source,
          cell,
          delay: index * lineStagger,
          fromPosition: source.cube.position.clone(),
          fromRotation: source.cube.quaternion.clone(),
          fromScale: source.cube.scale.x,
          target: needsHandover(source) ? field.landing(block, cell) : null,
          handedOver: false,
        };
      });
      const action: Playing = {
        flights,
        effects: [],
        lines: game().lastScoredLines,
        endpoint: { score: game().state.round.score, outcome: roundOutcome(game().state) },
        slot: narration.reserve(),
        drawn,
      };
      playing.push(action);
      present({
        step: (elapsed, delta) => updatePlay(action, elapsed, delta),
        // A reset drops it; any other cancellation (an effect that ran too long) lands it at
        // once, so its narration slot, landing and replacements still complete (#1033 review).
        cancel: () => {
          if (!resetting) return void updatePlay(action, Infinity, Infinity);
          playing = playing.filter((other) => other !== action);
          action.effects.forEach((effect) => effect.finish());
        },
      });
      playSfx("card.place.fly");
      options.changed();
      return true;
    },
    discard(sources) {
      const session = game();
      if (!sources.length || !session.discard(sources.map(({ block }) => block.id))) return false;
      hand.settle(sources);
      options.rackChanged();
      options.activated([
        ...new Set(session.lastDiscardActivations.map(({ sourceId }) => sourceId)),
      ]);
      hand.remove(sources);
      hand.sync(session.state.hand);
      options.deselect(sources.map(({ block }) => block.id));
      const effects = sources.map((source) => {
        source.cube.children.forEach((edge) => (edge.visible = false));
        source.cube.updateWorldMatrix(true, true);
        return createMaterialise(source.cube, {
          seconds: 1,
          out: true,
          reduced: options.reducedMotion(),
        });
      });
      // Model first (#775): the replacements are drawn now, with the discard; only their
      // appearance waits until the discarded cards have dissolved.
      const drawn = options.drawReplacements();
      hand.sync(session.state.hand);
      const action: Discarding = { sources: [...sources], effects, drawn };
      discarding.push(action);
      present({
        step: (_elapsed, delta) => updateDiscard(action, delta),
        cancel: () => {
          action.effects.forEach((effect) => effect.finish());
          // Not a reset: its dissolves are done, so its replacements are revealed now.
          if (!resetting) return void updateDiscard(action, 0);
          discarding = discarding.filter((other) => other !== action);
        },
      });
      playSfx("card.discard");
      options.changed();
      return true;
    },
    narration: sink,
    presentedActions: {
      take(id) {
        const action = waiting.get(id) ?? null;
        waiting.delete(id);
        return action;
      },
    },
    update(now, delta) {
      frameNow = now;
      hand.updateDrawIns(delta);
    },
    reset() {
      // Every action's effect is cancelled with its scope; one not yet started is dropped.
      resetting = true;
      for (const scope of Array.from(actionScopes)) options.visualEvents.cancel(scope);
      resetting = false;
      actionScopes.clear();
      waiting.clear();
      playing = [];
      discarding = [];
      narration.reset();
      shownScore = game().state.round.score;
    },
    dispose() {
      for (const action of [...playing, ...discarding]) action.effects.forEach((e) => e.finish());
    },
  };
}

/**
 * A scored line as plain data: its blocks and sources by id, its points and, in committed order,
 * what each activation's host shows alongside it (#919).
 */
export function capturedLine(
  line: PassiveScoredLine,
  alongside: (activation: RuleActivation) => AlongsideEvent | null = () => null,
): NarratedLine {
  return {
    blockIds: line.line.blocks.map(({ id }) => id),
    sourceIds: [...new Set(line.activations.map(({ sourceId }) => sourceId))],
    points: line.points,
    alongside: line.activations.flatMap((activation) => alongside(activation) ?? []),
  };
}
