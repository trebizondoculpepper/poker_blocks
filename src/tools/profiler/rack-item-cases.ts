/**
 * Profiling cases for every passive and usable rack item (#621): one case per registered
 * passive definition, built through the production token visual (`createPassiveVisual`) the rack
 * and shop use, with its extras and edges. Registered by enumerating the definitions; the
 * coverage source lists them all.
 */
import * as THREE from "three";
import { passiveVisualFor } from "./rack-item-object";
import { passiveDefinitions } from "../../passives";
import { profilingCases, profilingCoverage } from "./cases";

export const rackItemCaseId = (id: string) => `rack-item:${id}`;

for (const id of passiveDefinitions.names())
  profilingCases.register(rackItemCaseId(id), {
    family: "rack item",
    label: passiveDefinitions.get(id).name,
    defaultCount: 25,
    create: ({ seed }) => passiveVisualFor(id, `profile-${seed}`, new THREE.Euler(0.4, 0.7, 0)),
  });

profilingCoverage.register("rack item", () => passiveDefinitions.names().map(rackItemCaseId));
