# Crystal v3: clean-surface layered optics experiment (#644, #645)

**Agreed experiment, not a production choice.** The owner rejects the extra sub-facets of the previous approximation: the existing crystal's clean geometric faces must remain. V3 explores rear/front optical mapping on those faces. Implementation is #645 after this document merges; Dev 17 (#524) supplies comparison and owner audition. Production keeps its existing renderer until a separate decision. No convincing result or performance gain is asserted by this design.

## Evidence and decision

Source audit at `fe6d95be5b6231ec9ae0e2695fe153b5892a0ca7`:

- `src/visual/approximate-crystal.ts`, `facetPattern`: nearest-site cells introduce the unwanted subdivisions as texture detail, even though mesh topology is unchanged. `fillPane` repairs the earlier transparent-pane/wireframe defect; it does not address the owner's objection to the pattern.
- `src/visual/block-appearance.ts`, `approximateCrystal`: an outer material, inner shell and separate print already establish reusable appearance composition. Reuse this ownership/disposal boundary; a different registered assembly can supply a different optical technique.
- `src/visual/optics-backends.ts`, `withOpticsBackend`: selects an assembly through registered configuration without changing the material definition's other properties.
- `src/tools/crystal-comparison/room.ts`, `build/show`: seeded collection, fixed transforms and room-owned environment/lighting already support a controlled comparison. Existing screenshots and owner feedback are on #524.
- three.js 0.187.0 `envmap_fragment.glsl.js` and `envmap_physical_pars_fragment.glsl.js`: reflection lookups derive from view direction and surface normal. `WebGLRenderer.js` sorts opaque, transmissive and transparent render lists separately; a render-order number alone does not order across all lists or solve intersecting transparent objects.

Relevant primary references:

- NVIDIA GPU Gems, [Image-Based Lighting](https://developer.nvidia.com/gpugems/gpugems/part-iii-materials/chapter-19-image-based-lighting): environment maps provide reflected surroundings without rendering that environment anew for every view. This supports using a shared authored spectral lighting map, not the claim that our approximation will be convincing.
- NVIDIA GPU Gems 2, [Generic Refraction Simulation](https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-19-generic-refraction-simulation): perturbed image lookups and Fresnel blending approximate optical effects. Its image-distortion method first captures an image to sample. V3 borrows lookup/blend principles, **not** that capture pipeline or its cost/quality claims.

Decision: first audition two mapped layers without an intermediate texture. This preserves clean faces and avoids the previous subdivision pattern and physical transmission pass. A captured rear/scene image could produce stronger distortion, but introduces render-target, draw, memory and transparency costs; it is a possible later design, not an implicit part of #645. Full physical transmission remains the Current comparison backend. An opaque rainbow paint would be cheaper but offers less rear/front depth and is not this experiment.

## Appearance contract

Keep the source block geometry, macro faces, bevels, silhouette and artwork. Use the original geometric face normals on flat surfaces; existing bevels may change normals. Do not introduce normal-map grain, Voronoi/crackle cells, fake subdivisions, new mesh facets or vertex displacement. Incidence displacement means **offsetting map lookups**, never moving the surface.

One shared smooth environment texture supplies broad spectral gradients and pale/white lighting bands. Start with restrained saturation so the result need not read as rainbow foil. A procedural or authored static map is acceptable; it has no little polygon cells and is not regenerated per block or camera frame. Keep colour-space handling explicit and consistent with the renderer; do not treat encoded colour as linear twice.

The assembly has two optical layers, plus the existing separate artwork layer:

1. **Rear-facing layer.** Render the original mesh's back-facing surfaces as the visible optical interior/background. Sample the shared environment with a configurable rear lookup/bend response. Its opacity/intensity must leave a readable depth contribution rather than only bright outlines.
2. **Front-facing layer.** Render original front faces over the rear result. Sample that environment using a distinct front response and blend with a Fresnel-style incidence weight, stronger reflection toward grazing angles. Keep broad highlights and transitions smooth within each original face; geometric face boundaries provide the angular changes.
3. **Print.** Preserve legible rank/suit/letter artwork using existing print ownership. The optical displacement must not smear or move the printed symbols.

For a normalized surface normal N and direction V from surface to camera, use `abs(dot(N, V))` for incidence magnitude with the appropriate front/back normal convention. Offset strength is a smooth bounded function of incidence; the signed projected view direction in the face plane determines where to offset. A scalar angle alone cannot provide that direction. Guard normalization at face-on views and clamp grazing amplification to avoid jumps, seams or unbounded stretching. Apply the offset to the environment lookup in a consistent coordinate basis; preserve continuity across map wrapping/seams and stable lighting as the object rotates.

Opposite parallel normals produce the same mirror reflection direction: `reflect(I, N)` equals `reflect(I, -N)`. Therefore rear and front must not be indistinguishable duplicate mirror samples. Their registered configuration supplies distinct rear/front lookup responses (for example a bounded rear bend versus front reflection) and strengths. The implementation may tune these within the smooth mapped-layer contract; it must not restore sub-facet noise to hide a weak result.

The front layer blends over the already drawn rear layer. It does **not** read or refract the rendered rear pixels. Actual displaced sampling of that image would require a render target/copy or a different documented analytic method. Likewise, this experiment does not bend the scene behind the block, simulate multiple internal bounces or compute physical spectral dispersion. A smooth rainbow map is an artistic approximation of spectral lighting, not a wavelength simulation.

## Composition, resources and configuration

Add a registered backend labelled **Crystal v3**, with its own reusable appearance assembly; select it using the existing `opticsBackends` mechanism. Definitions/configuration own all variations. No room/material identity branch, kind-keyed side table, or marker trait check is permitted in generic code. Keep Current and the previous Approximation available as references in Dev 17. Adding this backend does not replace the production assembly.

Expose spectral strength, front/rear intensity, front/rear lookup offsets, rear opacity and Fresnel response through plain experiment configuration and existing developer controls. Defaults are provisional visual tuning, captured with review images; no game rule or model RNG depends on them. View incidence drives the optical motion; do not add time-driven noise or shimmer merely to make it look alive. Shared gradients/programs are reused, while per-appearance owned resources follow `BlockAppearance` cleanup. Repeated switches must not dispose shared maps, leak old materials or draw both backends accidentally.

Use deliberate culling, blend factors, depth-test/write settings and compatible render-list membership to ensure rear → front → artwork ordering. Do not assume transparent per-object sorting solves interleaving between neighboring blocks. Test overlaps explicitly and record limitations. No per-frame render target, framebuffer capture, scene copy, transmission pass, three-channel dispersion loop or crystal-fire shader belongs in the initial v3 assembly. Two optical surfaces still incur overdraw; the print and edges are additional draws, not a claim of two total draw calls.

Room orchestration stays in the Dev-prefixed tool trait under `src/tools/`; shared optics stays in reusable visual modules. Existing toggle controls reuse `ui.click`; no new player action or sound family is introduced. The effect presents geometry only and never mutates model outcomes or waits for a gameplay event to finish rendering.

## Audition and verification

The experiment must be selectable at `/?mode=dev17` without changing seed, card identity, art seed, geometry, collection positions/orientations, camera or lighting. Count changes remain explicit. Compare Current and Crystal v3 at Count 1 across several orientations, Count 9 and a many-object case; include face-on and grazing views, beveled edges, separated objects and overlapping objects. Toggle repeatedly and leave/re-enter the room. Check shader errors, colour stability, clipping/depth/sorting, cleanup and artwork readability.

Attach actual matching screenshots and preferably a short rotation clip to #645 and link them from #524. Include tested commit, URL, browser/GPU, resolution/pixel ratio, count and tuning settings. Identify software rendering explicitly. Record warmed CPU frame-time and draw/triangle/program statistics using the room; GPU time only when measured by a supported GPU timer. The source audit predicts avoided work, not a measured speed-up or a proven mobile result.

Owner review asks whether the clean faces, depth, view-dependent spectral movement and readable print are convincing. Approval of the experiment is not approval to switch production. Failure should lead to a reported result and a focused design question, not silent growth into a captured-image refraction pipeline. #524 remains the comparison/review umbrella; #645 owns v3 implementation. No topology/spatial query or gameplay-lifecycle work is a prerequisite for this rendering experiment.
