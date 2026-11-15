/**
 * The Present (#651; doc/presents.md, "Creation-fixed hidden contents"): an opaque wrapper holding
 * one playable card, fixed when it is made. It is the only drawable inventory object; its payload
 * is saved inside it. It opens through the shared opaque-container capability (#926), never by
 * rerolling, and its inspection says only that it holds an unknown playable card.
 *
 * `grant-present` makes one: it fixes the payload from the configured generation (by default the
 * next round's shop playable-card table, Paper excluded) on the run's seeded stream, then adds the
 * wrapper to the run deck. It reports the wrapper's ID for the reward receipt.
 */
import { activeDefinitions } from "./active-objects";
import type { CardBlock } from "./cards";
import { generateCard, type CardGeneration } from "./card-generator";
import { getMaterialDefinition, materialOf, withMaterial } from "./materials";
import type { StoredPayload } from "./playable-payload";
import { registerRuleCommand } from "./rule-commands";
import { faces } from "./traits/attachable";
import { inspectable } from "./traits/inspectable";

/** The wrapper with no contents yet: what the definition creates, and restores into. */
function presentShell(id: string): CardBlock {
  return withMaterial(
    {
      id,
      traits: {
        active: { definition: "present" },
        // A run-owned active (#928): retired in full when it is consumed.
        owner: { id: "runActive" },
        label: { name: "Present", symbol: "🎁" },
        selectable: {},
        attachable: { faces },
        inspectable: inspectable("Present — an unknown playable card, wrapped"),
      },
    },
    getMaterialDefinition("giftWrap" as never),
  );
}

activeDefinitions.register("present", {
  // A Present is nothing without its contents: a record lacking them is corrupt.
  requires: ["opaqueContainer"],
  lifecycle: { parent: "opaqueWrapper" },
  create: presentShell,
});

/** A Present wrapping `payload`. */
export function createPresent(id: string, payload: StoredPayload): CardBlock {
  const shell = presentShell(id);
  return { ...shell, traits: { ...shell.traits, opaqueContainer: { payload } } };
}

/** The descriptor a playable card is stored as inside a container. */
export function storedPlayable(card: CardBlock): StoredPayload {
  const identity = [card.traits.identity ?? []].flat()[0]!;
  return {
    id: card.id,
    definition: "playableCard",
    components: {
      pokerIdentity: { rank: identity.rank, suit: identity.suit.name },
      material: materialOf(card),
    },
  };
}

export type GrantPresentConfig = { generation: CardGeneration };

registerRuleCommand<GrantPresentConfig>("grant-present", ({ generation }, target) => {
  if (!target.random || target.round === undefined || !target.allocateId)
    throw new Error("grant-present: needs the run's random stream, round and ID allocation");
  const allocate = (base: string) => target.allocateId!(base);
  const random = () => target.random!();
  // Fixed now, for good: opening never rerolls it.
  const contents = generateCard(generation, target.round, random, () =>
    allocate("present.contents"),
  );
  const present = createPresent(allocate("present"), storedPlayable(contents));
  target.update({ ...target.state, deck: [...target.state.deck, present] });
  return [{ type: "present.granted", blockId: present.id }];
});
