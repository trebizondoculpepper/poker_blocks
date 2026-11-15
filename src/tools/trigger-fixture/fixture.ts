/**
 * The real-trigger fixture (#1177; doc/triggered-presentation.md, "Developer audition: real
 * commands, explicit test composition"): a Dev detonator material, installed only in development,
 * composed from the ordinary registered mechanics: a countdown that triggers it after one committed
 * play, then its configured responses (trigger the triggerable face neighbours, blast the face
 * neighbours with `explosion`, remove itself) and its on-trigger explosion presentation. Nothing is
 * faked: the model's commands, guards and facts run as they would for any triggered block.
 *
 * It is no normal-game bomb: it isn't in any catalogue, shop or reward, and only the developer mode
 * that composes this fixture deals it.
 */
import {
  getMaterialDefinition,
  installMaterialDefinitions,
  type MaterialDefinition,
} from "../../materials";

/** The Dev detonators' opaque material IDs: one on a countdown, one only a chain sets off. */
export const devDetonatorMaterial = "devDetonator";
export const devChainDetonatorMaterial = "devChainDetonator";

/** A copy of wood's look and physics, with the fixture's trigger composition. */
export function devDetonatorDefinition(): MaterialDefinition {
  const wood = getMaterialDefinition("wood");
  const { shop: _shop, transmogrifier: _transmogrifier, ...base } = wood;
  return {
    ...base,
    id: devDetonatorMaterial,
    name: "Dev detonator",
    // Provisional and dev-only: never certified for play.
    releaseStatus: { provisional: {} },
    // One committed play after it is placed, it triggers itself.
    triggerCountdown: { start: 1, countPlacement: false },
    triggerable: {
      responses: [
        // A neighbouring detonator detonates too (a real secondary, through the chain guard).
        {
          id: "trigger-targets",
          config: { select: { id: "face-neighbours", config: {} }, cause: "explosion" },
        },
        // The blast: ordinary neighbours go, steel and gold resist.
        {
          id: "destroy-targets",
          config: {
            select: { id: "face-neighbours", config: {} },
            cause: "explosion",
            removal: "field",
          },
        },
        { id: "self-destruct", config: { removal: "field" } },
      ],
    },
    appearance: { ...wood.appearance, onTrigger: { response: "explosion" } },
  } as MaterialDefinition;
}

/** The same detonator with no countdown: it goes off only when a neighbouring blast triggers it. */
export function devChainDetonatorDefinition(): MaterialDefinition {
  const { triggerCountdown: _countdown, ...detonator } = devDetonatorDefinition();
  return { ...detonator, id: devChainDetonatorMaterial, name: "Dev chain detonator" };
}

let installed = false;

/** Install the fixture's definitions once (development only). */
export function installTriggerFixture(): void {
  if (installed) return;
  installed = true;
  installMaterialDefinitions([devDetonatorDefinition(), devChainDetonatorDefinition()]);
}
