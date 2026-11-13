/**
 * Profiling render pipelines (#764; doc/profiler-render-passes.md). A case declares the production
 * passes its look needs as serializable `{handler, config}` references; each handler is registered
 * here. The runner builds the pipeline once per case in that case's host and renders every frame
 * through it: the declared passes in order, then the main render exactly once. It never asks what
 * a pass is, and never guesses passes from the objects.
 */
import type * as THREE from "three";
import { Registry } from "../../core/registry";
import {
  preservingRenderState,
  type FrameTime,
  type PassRenderer,
  type RenderPass,
} from "../../visual/render-pass";

/** One declared pass: a registered handler's name and its configuration, as plain data. */
export type PassReference = { handler: string; config?: Record<string, string | number | boolean> };

/** What a pass handler is given to build its pass, once per case. */
export type PassSetup = {
  renderer: PassRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** The collection root: every profiled object is under it, and only they are. */
  root: THREE.Object3D;
  /** The registered host the case is drawn in. */
  host: string;
  /** Hand a resource to the pipeline, to be disposed with it whatever happens. */
  own: <T extends { dispose(): void }>(resource: T) => T;
};

export type PassHandler = {
  /** Outputs this pass makes, for passes declared after it. */
  provides?: readonly string[];
  /** Outputs an earlier declared pass must make. */
  requires?: readonly string[];
  /**
   * Why this pass can't render a meaningful empty collection, if it can't: baseline-relative
   * values are then withheld with this reason, never taken from a main-only host.
   */
  baselineUnavailable?: string;
  /** Build the pass from production code: it owns its targets until disposed. */
  create(
    setup: PassSetup,
    config: NonNullable<PassReference["config"]>,
  ): RenderPass | Promise<RenderPass>;
};

export const profilingPasses = new Registry<PassHandler>("profiling pass");

/** The pipeline a case gets: its declared passes, then the main render. */
export type ProfilingPipeline = {
  passes: readonly PassReference[];
  /** Why baseline-relative values can't be given for it, if they can't. */
  baselineUnavailable: string | null;
  render(frame: FrameTime): void;
  dispose(): void;
};

/**
 * Check the declared passes before anything is built or timed: every handler is registered and
 * every requirement is made by a pass declared before it (which also rules out cycles).
 */
export function resolvePasses(
  passes: readonly PassReference[],
  registry: Pick<Registry<PassHandler>, "has" | "get"> = profilingPasses,
): PassHandler[] {
  const made = new Set<string>();
  return passes.map(({ handler }, index) => {
    if (!registry.has(handler))
      throw new Error(`pass ${index + 1} names no registered profiling pass: ${handler}`);
    const pass = registry.get(handler);
    const missing = (pass.requires ?? []).filter((output) => !made.has(output));
    if (missing.length)
      throw new Error(
        `pass ${index + 1} (${handler}) needs ${missing.join(", ")} from an earlier pass`,
      );
    for (const output of pass.provides ?? []) made.add(output);
    return pass;
  });
}

/**
 * Build a case's pipeline. A pass that fails to build disposes every pass and resource already
 * made; a caller abandoning a slow build disposes the pipeline when it arrives.
 */
export async function createPipeline(
  passes: readonly PassReference[],
  setup: Omit<PassSetup, "own">,
  registry: Pick<Registry<PassHandler>, "has" | "get"> = profilingPasses,
): Promise<ProfilingPipeline> {
  const handlers = resolvePasses(passes, registry);
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(resource: T): T => {
    owned.push(resource);
    return resource;
  };
  const dispose = () => {
    for (const resource of owned.splice(0).reverse()) resource.dispose();
  };
  const built: RenderPass[] = [];
  try {
    for (const [index, handler] of handlers.entries())
      built.push(own(await handler.create({ ...setup, own }, passes[index]!.config ?? {})));
  } catch (error) {
    dispose();
    throw error;
  }
  const { renderer, scene, camera, root } = setup;
  return {
    passes,
    baselineUnavailable:
      handlers.map(({ baselineUnavailable }) => baselineUnavailable).find(Boolean) ?? null,
    render(frame) {
      // Whatever a pass changes is put back before the main render, even if it throws.
      preservingRenderState(setup, () => {
        for (const pass of built) pass.render({ ...frame, renderer, scene, camera, hide: root });
      });
      renderer.render(scene, camera);
    },
    dispose,
  };
}

/** A pipeline as a person reads it: each pass with its configuration, then the main render. */
export function describePipeline(passes: readonly PassReference[]): string {
  const config = (values: PassReference["config"]) =>
    Object.entries(values ?? {})
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", ");
  return [
    ...passes.map(({ handler, config: values }) =>
      Object.keys(values ?? {}).length ? `${handler}(${config(values)})` : handler,
    ),
    "main render",
  ].join(" → ");
}
