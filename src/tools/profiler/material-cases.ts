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
import { quarterTurns } from "./motion";

const allMaterials = (): readonly MaterialDefinition[] => [
  ...materialDefinitions,
  ...experimentalMaterials,
];

/**
 * The parts the table advances from a block's pose (#973): its ongoing effects (smoke, dust) and
 * its contained contents, residue and inclusions, each handed the block's turn every frame. A look
 * composing any of them is also sampled turning; one with none is sampled at rest only, so
 * nothing spins without a part that could respond.
 */
export const poseFedParts = ({ appearance }: MaterialDefinition) =>
  [
    appearance.effects ?? [],
    appearance.contents ?? [],
    appearance.residue ?? [],
    appearance.inclusions ?? [],
  ].flat();

export const materialCaseId = (definition: MaterialDefinition) => `material:${definition.id}`;

for (const definition of allMaterials())
  profilingCases.register(materialCaseId(definition), {
    family: "material",
    label: definition.name,
    defaultCount: 25,
    motions: poseFedParts(definition).length ? [quarterTurns] : [],
    // The seed picks the card, so a collection shows varied artwork, the same on every run.
    create: ({ seed }) => tableBlock(standardDeck[seed % standardDeck.length]!, definition),
  });

profilingCoverage.register("material", () => allMaterials().map(materialCaseId));
