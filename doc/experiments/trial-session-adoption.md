# Prepared scenario sessions and trial replacement

Target contract for #900; implementation #901–#905, tracking epic #820. This supplements [the passive scenario bench](passive-test-bench.md). It places the missing run-host seam without adding mode-specific logic or another deck/scenario factory.

## Policy, preparation and adoption

The composed Dev scenario controller owns the selected scenario, effective settings, current seed and the choice of same-seed Apply versus explicit New Seed. It requests a registered session factory through an injected run-session host service. The host knows request IDs, prepared-session contracts and lifecycle mechanics, not room identities or which passive the panel edits. The service does not decide which scenario/seed/reward is appropriate. src/main.ts wires service references only.

A request contains a monotonically scoped request/generation ID, registered factory reference and immutable validated request configuration. The generic factory registry dispatches by capability/operation name. The scenario factory/setup adapter uses buildScenario/configurePassive and the current mode's configured rules/dealers; it does not invent a scene-keyed setup map. Unknown factories, versions or invalid inputs return typed diagnostics without adopting a partial result.

Preparation builds a candidate OFF TO THE SIDE. Its result is a prepared session containing all of the following together:

- The completed GameRun, including any explicitly configured setup-command replay.
- The applicable rules and complete created-card identity universe/reconstruction descriptor, not merely cards still in the draw pile.
- The exact candidate session RNG access: next, checkpoint, restore, seed and current cursor, all referring to the SAME stream the candidate run uses.
- Trial provenance: effective scenario/configuration versions, initial hydrated snapshot, explicit setup-command log, effective per-instance settings and new trial ID.

Exact TypeScript names can follow repository conventions; ownership and atomicity are mandatory. Do not reconstruct a prepared scenario from snapshot alone and attach a newly seeded random stream, nor replace its rollback hooks with the previous controller's stream. A replay may already have consumed RNG; its post-replay cursor and checkpoints travel with the candidate. Extend buildScenario's result minimally to expose its owned RNG/session bundle through a public interface; never inspect private Randomizer fields or infer the cursor by replaying effects a second time.

The registered run-setup adapter (#901) connects scenario preparation to the existing setup pipeline. Its start contribution returns the documented prepared-session output and provenance through the typed setup/factory context. The ordinary path has an adapter returning the same host contract. The shared runner dispatches registered setup/factory behavior uniformly; it must not test whether the current mode is dev20 or whether a scenario flag is present. Existing snapshot-based start handlers can retain their semantics through the ordinary adapter. The scenario result must not be flattened to a snapshot that loses its RNG/identity universe before adoption.

## Atomic replacement and generation ownership

The host installs a fully validated prepared session in one synchronous adoption boundary: active run, rules, identity/reconstruction data, RNG access and provenance change together. All subsequent gameplay randomness, checkpoint/rollback, saves and seed readouts use that active session's accessors. Existing callbacks must not close over an old controller randomizer. Normal new-run and Continue adapters preserve their current documented behavior and saved order/cursor; no unrelated gameplay/save migration is authorized.

Preparation failure leaves the active run, RNG cursor, score, selected cards and presentation generation untouched. Do not clear the table or consume the active gameplay RNG while merely validating an Apply request. A fresh seed comes from an injected seed source owned by the requesting controller policy; same-seed Apply reuses the recorded seed and does not request another one. Preparation is currently synchronous; no asynchronous work is required for this seam. If an implementation permits asynchronous providers, their generation token must reject stale completion before any active-session mutation.

After successful replacement, cancel the old drag/gesture ownership through the normal cancellation routes, invalidate old visual scopes/generation and detach old model subscriptions. Bind the new session and rebuild its field/hand/rack/readouts once from its committed current state. Configure the host transition so replacing a trial in the current scene rebinds its controller traits without an accidental second enter or an old listener surviving. A retired trial callback cannot mutate the new run or open its result screen. Do not wait for old animations to finish before adopting the new valid model session.

Hydrating the initial fixture and rebinding views publishes no historical placement/scoring/reward effects. Explicit setup-command replay ran on the candidate once; its committed model result/action log is retained, but adopting it does not execute the commands again. Initial rendering shows the candidate's final prepared state. Replay presentation can be a separately requested recorded demonstration, never a second model replay during installation. A success may emit a host trial-replaced notification with captured metadata for readouts/export; this is not a gameplay placement or scoring action.

## Apply, restart and controls

Apply validates the schema-derived edited configuration, constructs a new trial from the SAME initial scenario/seed and new effective settings, then adopts it. Scores, uses and player moves from the previous trial do not carry into a clean A/B trial. Only explicitly configured scenario setup commands replay. Restart without edits uses the same effective settings and seed. New Seed is a separate explicit controller action. Merely typing in an input does not restart the run.

The Dev panel requests this host operation and displays its diagnostics/result; it never assigns controller state or directly creates an untracked global GameRun. Control input owners retain keyboard/focus/gesture behavior. One appropriate configured UI action sound accompanies a confirmed action; reconstruction does not replay all original game sounds. Finite feedback goes through the shared scheduler, while readouts subscribe to current captured facts/snapshots. Input cannot be held because old scoring narration remains queued.

Trial export (#821) reads the adopted provenance plus subsequent committed actions. It records effective initial state/configuration, seed and RNG/replay metadata, not live service functions. Imports validate/reconstruct through the same preparation factory and codecs rather than a second mutable inventory. Existing non-experimental save namespaces remain isolated. Cover/pause does not create a new trial; exit disposes the controller, invalidates requests and stops old subscriptions.

## Source evidence and verification

Source audit on main: src/dev-scenario.ts:buildScenario privately constructs a Randomizer, uses it in GameRun.fromSnapshot and attaches matching checkpoint hooks, but ScenarioTrial currently returns only run/initialSnapshot/actionLog. src/game-run-controller.ts:newRun mutates controller-owned randomizer/rules/cards, runs setup and reconstructs a run; startRun then attaches controller randomCheckpoints unconditionally. A bare startRun(buildScenario(...).run) could therefore attach rollback hooks belonging to a DIFFERENT stream. This concrete integration gap is why a prepared-session contract is required.

src/run-setup.ts currently has policy/deck/start passes; its start context carries rules/deck/snapshot. src/save.ts already uses ordered snapshots, recorded recipes and registered rack traits. Reuse these seams and codecs; the new prepared-session output is an explicit small extension, not a claim it already exists. A room-specific reset function would hide the RNG/ownership mismatch and violate composition; repeated new global passive definitions would violate the previously selected instance-settings design.

Verify same-seed identical starting descriptors and future draws, changed settings isolated from shared definitions, post-replay RNG cursor and failed-action rollback matching an uninterrupted candidate, all active RNG callers sharing one stream, bad requests preserving the old session, normal Continue cursor/order compatibility, fresh trial IDs, old gesture/effect cancellation, single listener rebind, no historical reward/audio replay and explicit new-seed behavior. These are meaningful integration checks; no performance or full-run balance claim is made here.
