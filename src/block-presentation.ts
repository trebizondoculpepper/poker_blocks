/**
 * A block's public presentation providers (#893; doc/opaque-actives.md, "Capabilities, payload
 * and identity"): its name, face art and short label, each resolved through registered providers
 * tried in order, the first that answers winning. An ordinary card answers through its rank/suit
 * value provider; a rankless active through its own declared label, and with a blank face. No
 * provider asks what kind of block it is, and nothing fabricates a rank or suit.
 */
import { cardName, type CardBlock } from "./cards";
import { Registry } from "./core/registry";
import { cardFaceArt, type CardFaceOptions, type FaceArt } from "./visual/face-art";

/** Registered name providers: a block's public name, or undefined when this one has none. */
export const blockNameProviders = new Registry<(block: CardBlock) => string | undefined>(
  "block name provider",
);
/** The block's rank/suit value provider as a list: one entry, or none for a rankless block. */
const identityOf = (block: CardBlock) => [block.traits.identity ?? []].flat();
const labelOf = (block: CardBlock) => [block.traits.label ?? []].flat();

blockNameProviders.register("rankAndSuit", (block) => identityOf(block).map(cardName)[0]);
blockNameProviders.register("label", (block) => block.traits.label?.name);

/** Registered face-art providers, tried in order. */
export const blockFaceArtProviders = new Registry<
  (block: CardBlock, options: CardFaceOptions) => FaceArt | undefined
>("block face art provider");
blockFaceArtProviders.register(
  "rankAndSuit",
  (block, options) => identityOf(block).map((identity) => cardFaceArt(identity, options))[0],
);

/** A short chip label: its text and colour (the deck view). */
export type BlockChip = { text: string; color?: string };
export const blockChipProviders = new Registry<(block: CardBlock) => BlockChip | undefined>(
  "block chip provider",
);
blockChipProviders.register(
  "rankAndSuit",
  (block) =>
    identityOf(block).map(({ rank, suit }) => ({
      text: `${rank}${suit.symbol}`,
      color: suit.color,
    }))[0],
);
blockChipProviders.register(
  "label",
  (block) => labelOf(block).map(({ symbol }) => ({ text: symbol }))[0],
);

/** The first answer among a registry's providers, in registration order. */
function firstAnswer<A extends unknown[], T>(
  registry: Registry<(...args: A) => T | undefined>,
  ...args: A
): T | undefined {
  for (const name of registry.names()) {
    const answer = registry.get(name)(...args);
    if (answer !== undefined) return answer;
  }
  return undefined;
}

/** The block's public name: its rank and suit, or its declared label; its ID as a last resort. */
export const blockName = (block: CardBlock): string =>
  firstAnswer(blockNameProviders, block) ?? block.id;

/** The block's face art. */
export const blockFaceArt = (block: CardBlock, options: CardFaceOptions = {}): FaceArt =>
  firstAnswer(blockFaceArtProviders, block, options) ?? blankFace(block);

/**
 * No provider answers: a plain face, seeded by the block's own ID so its material's noise is
 * stable. A fallback after every registered provider, so a later provider can still answer.
 */
const blankFace = (block: CardBlock): FaceArt => ({ seed: block.id, paint: () => {} });

/** The block's short chip label. */
export const blockChip = (block: CardBlock): BlockChip =>
  firstAnswer(blockChipProviders, block) ?? { text: "•" };
