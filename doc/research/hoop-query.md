# Hoop/tunnel query research (#883)

Research for the provisional [In the Loop](../experiments/in-the-loop.md) passive. It asks whether a reusable, exact, bounded boolean query can say "this occupied field has at least one hoop or through-tunnel". Under the brief, a flat ring and a deeper tunnel must qualify. A solid filled slab or cube, an open U, and mere graph cycles of face-adjacent cells must not. This document reports evidence and options; it selects no runtime algorithm. Detector semantics belong to #884, and the runtime query to #885.

Evidence: [hoop-query-probe.mjs](hoop-query-probe.mjs), dependency-free, run with `node doc/research/hoop-query-probe.mjs`. It asserts every fixture verdict below and writes [hoop-query-results.json](hoop-query-results.json).

## Findings

**Holes are the first Betti number, b1, and it can be computed exactly without a library.** Treat the occupied cells as a cubical complex, the union of closed unit cubes. This is the model behind [GUDHI cubical complexes](https://gudhi.inria.fr/python/latest/cubical_complex_user.html) and the [scikit-image Euler-number reference](https://scikit-image.org/docs/stable/auto_examples/segmentation/plot_euler_number.html).

- The Euler characteristic is χ = V − E + F − C, counted over the complex's distinct vertices, edges, faces and cubes.
- For a 3D complex, χ = b0 − b1 + b2, where b0 is the number of connected pieces, b1 the number of independent loops or tunnels, and b2 the number of sealed cavities. Therefore b1 = b0 + b2 − χ.
- The probe counts χ on a doubled lattice: each cell contributes its 27 closure elements, and the parity of the coordinates gives each element's dimension. b0 is found by flood fill. b2 is the number of background regions that cannot reach the outside.

Every term is integer and deterministic: no floating point, sampling or timeout.

**b1, not graph cycles or sealed voids, separates the owner's examples.** The probe checks each case under both conventions defined next.

| Fixture                                           | Cells   | b1 (closed) | b1 (face) | Brief verdict             |
| ------------------------------------------------- | ------- | ----------- | --------- | ------------------------- |
| Flat 3×3 ring, in XY, XZ and YZ                   | 8       | 1           | 1         | qualifies                 |
| 5×5 ring                                          | 16      | 1           | 1         | qualifies                 |
| Through-tunnel, depth 3 and depth 6               | 24 / 48 | 1           | 1         | qualifies                 |
| Tunnel bending a corner inside a 3×3×3 block      | 23      | 1           | 1         | qualifies                 |
| Two separate rings                                | 16      | 2           | 2         | qualifies (boolean: once) |
| One block with two openings                       | 41      | 2           | 2         | qualifies (boolean: once) |
| Solid 2×2 slab (a 4-cycle in the adjacency graph) | 4       | 0           | 0         | must not                  |
| Solid 3×3×3 cube                                  | 27      | 0           | 0         | must not                  |
| Open U                                            | 7       | 0           | 0         | must not                  |
| Long line; four sparse distant cells              | 12 / 4  | 0           | 0         | must not                  |
| Sealed shell (one enclosed empty cell)            | 26      | 0 (b2 = 1)  | 0         | not the objective         |
| Diamond of four cells touching only at edges      | 4       | **1**       | **0**     | convention decides        |
| Skew loop of four cells touching only at corners  | 4       | **1**       | **0**     | convention decides        |

The solid slab is the brief's key negative. It has a 4-cycle in the face-adjacency graph, yet b1 = 0, because b1 measures empty space passing through the solid rather than cycles in the graph. The sealed shell shows why the existing [lifecycle geometry probe](gameplay-lifecycle-opportunities.md#bounded-geometry-probe) is the wrong tool: it counts sealed empty cells, which is b2, and is blind to tunnels. A shell has b2 = 1 and b1 = 0, while a tunnel has b1 = 1 and b2 = 0.

## The decision the evidence cannot make: what counts as contact

The two conventions agree on every owner fixture and differ only when cells touch at an edge or corner without sharing a face.

- **Closed:** cells are closed cubes, so edge or corner contact joins them. Foreground is 26-connected and background 6-connected, the standard dual pair. A diamond of four edge-touching cells then encloses a hole. The cost is lowest: it runs directly on the cells.
- **Face:** only shared faces join cells. Foreground is 6-connected and background 26-connected. The probe computes this exactly by refining the grid ×3. Each refined voxel is filled when every cell it lies within or between is occupied. A cell fills a 2×2×2 block, a shared face fills a bridge, four cells round an edge fill that edge line, and eight cells round a vertex fill the corner. The closed method then runs on the refined voxels. Edge- or corner-only contact leaves a gap, so it encloses nothing.

The face convention matches the game's existing reaction neighbourhood: six faces, with edges and corners not reacting ([material-phases.md](../material-phases.md), "Deterministic bounded cross-phase chaining"). The closed convention matches what a player sees: cubes meeting at an edge visibly close a ring. Choosing between them changes which boards are rewarded, so it is a consequential owner or designer decision for #884, recorded below as an open question. The background convention is fixed by the foreground choice, because using the dual pair is what makes b1 well defined. It is not a separate decision.

## Bounds and unavailable behaviour

The cost is linear in the number of complex elements, about 11 per cell for the closed convention on these fields and about 190 per cell for the face convention after refinement. The b2 term additionally floods each connected piece's padded bounding box.

Timings below were measured on one machine with string-keyed maps, unoptimised. They show scale only; per the brief, no reward may depend on them.

| Cells (random connected) | Closed: elements / ms | Face: elements / ms |
| ------------------------ | --------------------- | ------------------- |
| 27                       | 433 / ~0.6            | 4,290 / ~8          |
| 125                      | 1,587 / ~1.5          | 22,451 / ~35        |
| 500                      | 5,736 / ~8            | 93,705 / ~180       |

- **Sparse distant cells** cost nothing extra. Each connected piece's cavity flood uses that piece's own box, and separate pieces are never boxed together (the "four sparse distant cells" fixture).
- **A long, thin connected shape** has a large box. A 180-cell staircase spans about 62³. The probe gives the cavity flood an explicit volume budget and returns `{available: false}` when it is exceeded, rather than guessing. This matches the [context-query](../game-architecture.md) unavailable policy, under which an unavailable result is never zero.
- **A box-free cavity count** is a candidate refinement, not established here. Flooding only the empty cells within one step of the solid, rather than the whole box, would make b2 linear in the surface. It needs its own proof and fixtures before it is relied on.
- **Exact versus bounded:** both conventions are exact whenever they answer. The only bound is the cavity flood's volume budget, which is explicit, deterministic and independent of machine speed. The bounded part could be dropped entirely by a convention that ignores cavities (b1 ≥ b0 − χ is a lower bound), but that undercounts when cavities exist, so it is not recommended.

## Alternatives considered

- **Cycles in the cell-adjacency graph** (cycle rank E − V + b0) count a solid 2×2 slab as a loop. Rejected; the brief names this exact false positive.
- **The sealed-cavity count** from the existing probe detects shells, not tunnels. Rejected as the detector, but kept as the b2 term.
- **Planar-only detectors** (per-layer 2D hole counts) miss bent tunnels and tunnels that run across layers. The brief forbids narrowing to planar.
- **Camera-projected gaps** depend on the view and are not authoritative. Rejected per the brief.
- **A topology library** (GUDHI is C++/Python; scikit-image is Python) is not available as a JavaScript runtime dependency. The arithmetic above needs none.

## Questions for #884 (designer/owner)

1. **Contact convention:** should cells touching only at an edge or a corner close a hoop (closed), or must a hoop be built from face-joined cells (face, matching reactions)? The evidence above shows both are exact. Face costs about 16× more elements but still runs in milliseconds at these sizes.
2. **Cavity budget:** what volume budget should the cavity term have before the query reports unavailable, and should unavailable mean "not eligible" for In the Loop?

## Verification limits

The fixtures are small hand-built shapes plus seeded random connected fields of up to 500 cells. The probe does not establish browser performance, normal play distributions or an incremental (per-play) update. Recomputing from each scoring snapshot is assumed, since queries are snapshot-scoped. b1 = 1 for the ring, tunnel and bent tunnel and b1 = 0 for the slab, cube, U and line are asserted by the probe under both conventions.
