/**
 * Appearance prepasses (#969; doc/presentation-contracts.md, "Prismatic Crystal promotion (#749)",
 * and doc/profiler-render-passes.md, "Case declares, host owns"): a pass an appearance needs
 * before its host's main render, such as a capture of back facets, declared by the appearance and
 * owned by the host that draws it.
 *
 * - **Declared:** an appearance lists plain references (`{ handler, config }`) to passes registered
 *   here by name. Nothing guesses a pass from a mesh, a material or an identity.
 * - **Host-owned:** each render context (one renderer, scene and camera) has its own
 *   `PrepassContext`, which makes one pass per distinct reference the first time a mounted
 *   appearance requires it. Its targets are that context's alone, so two hosts or cameras never
 *   sample each other's capture. The pass is disposed when the last appearance needing it lets go,
 *   or when the context is disposed.
 * - **Each frame,** `render` runs the context's passes in the order they were first required,
 *   inside one preserved render state (target, clear colour and alpha, camera layers and
 *   background are put back even if a pass throws), then its owner does the main render.
 * - **Resize and re-entry** are each pass's own: a pass sizes its targets from the drawing buffer
 *   every frame. A context with no requirements does nothing.
 */
import { Registry } from "../core/registry";
import { preservingRenderState, type PassFrame, type RenderPass } from "./render-pass";

/** A pass an appearance needs: a registered prepass by name, and its plain configuration. */
export type PrepassReference = { handler: string; config?: unknown };

/** A registered prepass: builds one pass, owned by the context that asked for it. */
export type AppearancePrepass = { create(config: unknown): RenderPass };

export const appearancePrepasses = new Registry<AppearancePrepass>("appearance prepass");

/** Problems with an appearance's declared prepasses: an unknown name, or no name at all. */
export function prepassProblems(
  references: readonly PrepassReference[],
  registry: Pick<Registry<AppearancePrepass>, "has"> = appearancePrepasses,
): string[] {
  return references.flatMap(({ handler }, index) =>
    typeof handler !== "string" || !registry.has(handler)
      ? [`prepass ${index + 1} names no registered appearance prepass: ${String(handler)}`]
      : [],
  );
}

/** Where an appearance's requirements go: whoever mounts it requires them, and lets go after. */
export type PrepassRequirements = {
  /** Require these passes while the returned release has not been called. */
  require(references: readonly PrepassReference[]): () => void;
};

/** One reference's key: the same handler and configuration share one pass in a context. */
const keyOf = ({ handler, config }: PrepassReference) =>
  `${handler}\u0000${JSON.stringify(config ?? null)}`;

/** One render context's prepasses: its own passes and targets, and how many need each. */
export function createPrepassContext(
  registry: Pick<Registry<AppearancePrepass>, "has" | "get"> = appearancePrepasses,
) {
  const passes = new Map<string, { pass: RenderPass; users: number }>();
  let disposed = false;

  const release = (key: string) => {
    const entry = passes.get(key);
    if (!entry || --entry.users > 0) return;
    passes.delete(key);
    entry.pass.dispose();
  };

  return {
    require(references: readonly PrepassReference[]): () => void {
      if (disposed || !references.length) return () => {};
      const problems = prepassProblems(references, registry);
      if (problems.length) throw new Error(problems.join("; "));
      const keys: string[] = [];
      try {
        for (const reference of references) {
          const key = keyOf(reference);
          const entry = passes.get(key);
          if (entry) entry.users++;
          else
            passes.set(key, {
              pass: registry.get(reference.handler).create(reference.config),
              users: 1,
            });
          keys.push(key);
        }
      } catch (error) {
        // A pass that can't be made leaves nothing held by this requirement.
        keys.forEach(release);
        throw error;
      }
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        keys.forEach(release);
      };
    },
    /** Run every required pass for this frame, putting the render state back afterwards. */
    render(frame: PassFrame): void {
      if (!passes.size) return;
      preservingRenderState(frame, () => {
        for (const { pass } of passes.values()) pass.render(frame);
      });
    },
    /** How many distinct passes this context holds now. */
    get size(): number {
      return passes.size;
    },
    dispose(): void {
      disposed = true;
      for (const { pass } of passes.values()) pass.dispose();
      passes.clear();
    },
  };
}

export type PrepassContext = ReturnType<typeof createPrepassContext>;

/**
 * Several contexts drawn by one host (the table: its board and its hand) taking requirements
 * together: a block can move between them, so each of its passes is held in every context.
 */
export function prepassRequirements(contexts: readonly PrepassContext[]): PrepassRequirements {
  return {
    require(references) {
      const releases: (() => void)[] = [];
      try {
        for (const context of contexts) releases.push(context.require(references));
      } catch (error) {
        // A context that can't take it leaves nothing held in the ones before it (#1040 review).
        releases.forEach((release) => release());
        throw error;
      }
      return () => releases.forEach((release) => release());
    },
  };
}
