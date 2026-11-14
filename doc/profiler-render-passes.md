# Profiler render-pass capability (#764)

Concrete extension of [automatic profiling](automatic-profiling.md) and [animation fidelity](presentation-contracts.md#profiler-animation-fidelity-752). Source audit at `388642f`: `ProfiledObject` (`tools/profiler/cases.ts`) offers object/update/dispose; runner `frame` times updates and one `renderer.render`; `optics-backends.ts` declares `frame` prepasses for Internal/Refraction/Calm Water; the gallery invokes them, but a profiler recipe cannot. Omitting them measures an incomplete pipeline. This is a source finding, not a measured GPU result.

## Case declares, host owns

Add a **registered profiling render-pipeline capability** selected by the case recipe through a serializable `{handler, config}` reference. A recipe may use the default main-only pipeline or declare an ordered list of production pass requirements. The registered representative host resolves/validates these requirements during set setup. Generic runner code never looks up a backend/material identity or guesses passes from meshes. Unsupported/missing capabilities are coverage/setup failures, not a successful static approximation.

The pipeline builder receives renderer, scene, camera, current object collection root, fixed host configuration and a scoped resource allocator. It returns `{render(frame), dispose()}`. `render(frame)` invokes the production prepass adapters in declared dependency order and the main render exactly once; frame contains the same presentation clock/delta/reduced-motion inputs used by object updates. Normal construction/update still uses production visual factories. Avoid installing an `Object3D.onBeforeRender` hook that recursively starts a scene capture per object; a compatible capture runs once per collection/frame.

Pass implementations are owned by the reusable production appearance subsystem, not copied shader/render code inside profiler files. Where existing prototypes keep module-global render targets, refactor their resources into renderer/host-scoped instances shared by compatible objects. A pass receives the collection root/exclusion handles explicitly; it does not discover object identity. Multiple camera/context hosts cannot sample another renderer's stale target. Resolve pass ordering/required buffers at setup and reject cycles/missing outputs before timing.

## Timing and baseline

Run object updates, then all declared passes and main rendering inside the CPU update/submission measurement. The GPU timer brackets **all rendering passes**, not just the final surface. Preserve renderer/camera/clear/layer/render-target state in finally paths. Record ordered pipeline references, pass count and host configuration in each result/export so comparisons are inspectable.

Renderer.info counters normally reset per render; aggregate draws/triangles across the pipeline by explicitly controlling/resetting the counters at the measurement boundary, then restore the prior renderer setting. Resource counts capture the live post-frame state without adding per-pass memory snapshots as if they were distinct allocations. Do not call draw counts GPU time.

The empty baseline uses the same host/pipeline settings with an empty collection, allowing passes to render their valid empty inputs. A different pipeline cannot reuse another case's baseline. If a pass cannot supply a meaningful empty-host baseline, report raw timings and unavailable baseline-relative values with a reason; never silently subtract the main-only host. First-use setup/compile work is recorded separately, warmed steady-state samples include all passes.

## Ownership and verification

Pipeline resources live for one measurement set/cohort as configured by the runner, and dispose on completion, cancellation, timeout, error or context loss; no per-frame target allocation. Dispose only owned render targets/material copies; share immutable maps/programs within their declared scope. Cancel during async pipeline preparation invalidates its generation and disposes late arrivals. Include all targets in resource-repeat diagnostics.

Tests register a synthetic prepass pipeline with no material identity, prove order and exactly-one main render, GPU/CPU bracket inclusion, counter aggregation, matched versus unavailable baseline, and state restoration after a thrown pass. Test two independent renderer/camera scopes and 1/10/50 collections. Browser evidence must show current capture data while moving/animating, followed by JSON/CSV/HTML records identifying that pipeline. Then register recipes for Refraction/Internal and the two water presets as those appearances become available. No claim of full optics coverage until these supported recipes complete through their actual pipelines.
