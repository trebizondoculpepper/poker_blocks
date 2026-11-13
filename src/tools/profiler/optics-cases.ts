/**
 * Profiling recipes for the optics backends (#764; doc/profiler-render-passes.md): one case per
 * registered backend, drawing the crystal the comparison room uses through that backend's
 * production assembly. A backend whose look needs passes before the main render (a background or
 * inner capture: Refraction, Internal, Calm water) declares them through the generic
 * `opticsCapture` pass, so every sample renders its whole pipeline, never a stale capture.
 * Registered by enumerating the backends, so a new one gets a case without a line here.
 */
import { standardDeck } from "../../cards";
import { getMaterialDefinition } from "../../materials";
import { opticsBackends, withOpticsBackend } from "../../visual/optics-backends";
import { tableBlock } from "./block-object";
import { profilingCases, profilingCoverage } from "./cases";
import { profilingPasses, type PassReference } from "./pipelines";

/** The material the recipes draw: the comparison room's crystal. */
const opticsMaterial = "prismatic";

/**
 * A backend's own capture passes for the profiler's renderer, built from production code and
 * disposed with the pipeline. A backend that declares none can't be named here: a setup failure.
 */
profilingPasses.register("opticsCapture", {
  provides: ["capture"],
  create(_setup, { backend }) {
    const capture = opticsBackends.get(String(backend)).capture;
    if (!capture) throw new Error(`optics backend ${String(backend)} declares no capture passes`);
    return capture();
  },
});

export const opticsCaseId = (backend: string) => `optics:${backend}`;

/** The passes a backend's look needs: its capture, if it declares one, then the main render. */
const passesFor = (backend: string): PassReference[] =>
  opticsBackends.get(backend).capture ? [{ handler: "opticsCapture", config: { backend } }] : [];

for (const backend of opticsBackends.names())
  profilingCases.register(opticsCaseId(backend), {
    family: "optics",
    label: opticsBackends.get(backend).label,
    variant: `${opticsMaterial} block`,
    defaultCount: 9,
    pipeline: passesFor(backend),
    // The seed picks the card, so a collection shows varied artwork, the same on every run.
    create: ({ seed }) =>
      tableBlock(
        standardDeck[seed % standardDeck.length]!,
        withOpticsBackend(getMaterialDefinition(opticsMaterial), backend),
      ),
  });

profilingCoverage.register("optics", () => opticsBackends.names().map(opticsCaseId));
