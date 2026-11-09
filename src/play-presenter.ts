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
import * as THREE from "three";
import { playSfx } from "./audio/sfx";
import type { CameraViewService } from "./camera-view";
import { roundOutcome, type RoundOutcome } from "./dealer";
import { tweenValue } from "./easing";
import { tintSeconds, type Candidate, type FieldView } from "./field-view";
import type { GameSession } from "./game-session";
import type { HandView } from "./hand-view";
import type { BlockViews, RenderedBlock } from "./rendered-blocks";
import { magnitudeSfxFor } from "./score-presentation";
import { presentationOrder, type ScoredLine } from "./scoring";
import type { Cell } from "./traits/attachable";
import { isTransparent } from "./traits/transparent";
import { createMaterialise } from "./visual/materialise";

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
  startedAt: number;
  /** Every running dissolve, for clean-up. */
  effects: Materialise[];
};

/** A discard being shown. */
type Discarding = {
  sources: RenderedBlock[];
  startedAt: number;
  effects: Materialise[];
};

/** One scoring line waiting to be shown: tint its row, play its sound, add its points. */
type ScoreStep = { at: number; line: ScoredLine };

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
  /** Advance the flights and dissolves by one frame. */
  update(now: number, delta: number): void;
  /** Present due scoring lines and, after the last, the stage's outcome. */
  updateScore(now: number): void;
  /** Stop presenting: the score shown jumps to the session's (a new run, a forced outcome). */
  reset(): void;
  dispose(): void;
};

const lineStepMs = 320;
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
  return isTransparent(rendered.block);
}

export function createPlayPresenter(options: {
  game(): GameSession;
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
  /** The hand has room again: draw replacements. */
  refill(): void;
  /** A safe point to save the run. */
  save(): void;
  /** The stage's outcome has been announced. */
  decided(outcome: RoundOutcome, now: number): void;
}): PlayPresenter {
  const { views, hand, field, cameraView } = options;
  const game = () => options.game();
  let playing: Playing | null = null;
  let discarding: Discarding | null = null;
  let scoreSteps: ScoreStep[] = [];
  let outcomeAt: number | null = null;
  let shownScore = game().state.round.score;
  const placementTarget = new THREE.Vector3();
  const placementRotation = new THREE.Quaternion();

  /** Present the lines from the play that just landed, lowest score first. */
  function announceScore(now: number): void {
    const lines = presentationOrder(game().lastScoredLines);
    scoreSteps = lines.map((line, index) => ({ at: now + index * lineStepMs, line }));
    // Let the last line's tint finish before announcing a stage outcome.
    outcomeAt = lines.length > 0 ? now + (lines.length - 1) * lineStepMs + tintSeconds * 1000 : now;
  }

  function updatePlay(action: Playing, now: number, delta: number): void {
    const elapsed = (now - action.startedAt) / 1000;
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
    if (elapsed < lasts) return;
    playing = null;
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
    options.moved();
    playSfx("card.attach");
    announceScore(now);
    cameraView.scheduleCameraMove();
    options.refill();
    options.save();
  }

  function updateDiscard(action: Discarding, now: number, delta: number): void {
    const elapsed = (now - action.startedAt) / 1000;
    action.effects.forEach((effect) => effect.update(delta));
    if (elapsed < 1) return;
    discarding = null;
    action.sources.forEach((source) => views.dispose(source));
    options.refill();
    options.save();
  }

  return {
    get busy() {
      return playing !== null || discarding !== null;
    },
    get presenting() {
      return playing !== null || scoreSteps.length > 0 || outcomeAt !== null;
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
      hand.settle(sources);
      const landed = next.field.slice(-sources.length);
      options.deselect(ids);
      hand.remove(sources);
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
      playing = { flights, startedAt: performance.now(), effects: [] };
      playSfx("card.place.fly");
      options.changed();
      return true;
    },
    discard(sources) {
      const session = game();
      const coinsBefore = session.state.coins;
      const passivesBefore = session.state.passiveRack.length;
      if (!sources.length || !session.discard(sources.map(({ block }) => block.id))) return false;
      hand.settle(sources);
      if (session.state.coins > coinsBefore) playSfx("passive.coins");
      if (session.state.passiveRack.length > passivesBefore) playSfx("passive.granted");
      options.rackChanged();
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
      discarding = { sources: [...sources], startedAt: performance.now(), effects };
      playSfx("card.discard");
      options.changed();
      return true;
    },
    update(now, delta) {
      hand.updateDrawIns(delta);
      if (playing) updatePlay(playing, now, delta);
      if (discarding) updateDiscard(discarding, now, delta);
    },
    updateScore(now) {
      while (scoreSteps.length > 0 && scoreSteps[0].at <= now) {
        const { line } = scoreSteps.shift()!;
        field.tint(line.line.blocks, now);
        const sound = magnitudeSfxFor(line.points);
        if (sound) playSfx(sound, { jitter: 0 });
        shownScore += line.points;
        options.changed();
      }
      if (outcomeAt === null || outcomeAt > now) return;
      outcomeAt = null;
      shownScore = game().state.round.score;
      options.decided(roundOutcome(game().state), now);
      options.changed();
    },
    reset() {
      playing = null;
      discarding = null;
      scoreSteps = [];
      outcomeAt = null;
      shownScore = game().state.round.score;
    },
    dispose() {
      for (const action of [playing, discarding]) action?.effects.forEach((e) => e.finish());
    },
  };
}
