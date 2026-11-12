/**
 * Profiling cases for every registered material (#620): one case per material definition,
 * including the experimental ones and the contained (container and contents) looks, each built
 * through the production block appearance. Registered by enumerating the definitions, so a new
 * material gets a case without a line here; the coverage source lists them all, so a missing one
 * shows as uncovered.
 */
import { standardDeck } from "../../cards";
import {
  experimentalMaterials,
  materialDefinitions,
  type MaterialDefinition,
} from "../../materials";
import { tableBlock } from "./block-object";
import { profilingCases, profilingCoverage } from "./cases";

const allMaterials = (): readonly MaterialDefinition[] => [
  ...materialDefinitions,
  ...experimentalMaterials,
];

export const materialCaseId = (definition: MaterialDefinition) => `material:${definition.id}`;

for (const definition of allMaterials())
  profilingCases.register(materialCaseId(definition), {
    family: "material",
    label: definition.name,
    defaultCount: 25,
    // The seed picks the card, so a collection shows varied artwork, the same on every run.
    create: ({ seed }) => tableBlock(standardDeck[seed % standardDeck.length]!, definition),
  });

profilingCoverage.register("material", () => allMaterials().map(materialCaseId));
