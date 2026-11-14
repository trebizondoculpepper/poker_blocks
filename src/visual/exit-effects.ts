/**
 * Every registered exit effect, loaded (#511 review): code that runs block exits imports the
 * presenter from here, so each effect a material's exit sequence names is registered before it runs.
 * A new effect module adds its import here.
 */
import "./exit-burst";
import "./exit-fade";
import "./exit-fracture";
import "./exit-fragments";
import "./flash-shudder";

export { createExitPresenter, exitEffects, exitTargets } from "./exit-presentation";
export type { ExitSequence, ExitSnapshot, ExitVisual } from "./exit-presentation";
