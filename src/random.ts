/**
 * The session randomizer: one reproducible random sequence for a game session, so a run can be
 * replayed from its seed (#134).
 *
 * The session owns the generator and its position. Every game random request goes through it,
 * and each request names its **context** ("deck.shuffle", "shop.stock", "die.d20") so a future
 * passive modifier can adjust one distribution without touching the callers. Nothing modifies a
 * distribution yet: `modifiers` is the extension point, not a feature.
 *
 * Reproducing a sequence needs the same seed *and* the same sequence of requests, which is why
 * the position is saved with the run. Presentation randomness (the wobble of a placed block, a
 * music choice) is deliberately not on this stream: it would make replay depend on how long a
 * player looked at the table.
 */

/** A reproducible pseudo-random sequence, with a position that can be saved and restored. */
export class Randomizer {
  /** The secret seed the session started from. Shown on the win and lose screens. */
  readonly seed: number;
  private state: number;
  private draws: number;
  /** Per-context distribution modifiers, keyed by context. The extension point for #97. */
  private readonly modifiers = new Map<string, (value: number) => number>();

  constructor(seed: number, position = 0) {
    this.seed = seed;
    this.state = seed >>> 0;
    // Advance to the saved position, so Continue resumes the same sequence rather than
    // replaying it from the start. `next` counts the draws it makes, so rewind the count to
    // where the saved run had reached.
    for (let skip = 0; skip < position; skip++) this.next();
    this.draws = position;
  }

  /** Where the sequence has reached, saved with the run so Continue resumes it. */
  get cursor(): number {
    return this.draws;
  }

  /** The next value in [0, 1), the primitive every other request is built from. */
  next(): number {
    // mulberry32: small, fast, and good enough to make a run repeatable.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    this.draws++;
    let mixed = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max], both ends included. */
  int(context: string, min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`random.int("${context}"): bad range ${min}..${max}`);
    }
    const span = max - min + 1;
    return min + Math.min(span - 1, Math.floor(this.adjusted(context) * span));
  }

  /** True with probability `chance`; decimals such as 0.25 are exact enough for gameplay. */
  chance(context: string, probability: number): boolean {
    if (!(probability >= 0 && probability <= 1)) {
      throw new RangeError(`random.chance("${context}"): ${probability} is not in [0, 1]`);
    }
    return this.adjusted(context) < probability;
  }

  /** One of `items`, chosen in proportion to its weight. An item without a weight counts as 1. */
  weighted<T>(context: string, items: readonly T[], weight: (item: T) => number = () => 1): T {
    if (!items.length) throw new RangeError(`random.weighted("${context}"): nothing to choose`);
    const weights = items.map(weight);
    const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
    if (!(total > 0)) throw new RangeError(`random.weighted("${context}"): no weight to choose`);
    let point = this.adjusted(context) * total;
    for (const [index, item] of items.entries()) {
      point -= Math.max(0, weights[index]);
      if (point < 0) return item;
    }
    return items[items.length - 1];
  }

  /** A shuffled copy: `items` is left alone, so a caller's order is never a surprise. */
  shuffle<T>(context: string, items: readonly T[]): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = this.int(`${context}.${index}`, 0, index);
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    return shuffled;
  }

  /**
   * The raw value for a context, after any modifier has adjusted the distribution. The hook is
   * where a future passive changes the odds for one context; nothing registers one yet.
   */
  private adjusted(context: string): number {
    const value = this.next();
    const modifier = this.modifiers.get(context);
    return modifier ? modifier(value) : value;
  }

  /**
   * Adjust every draw made for one context, by mapping its raw value to another in [0, 1).
   * No game code registers one in this version; a passive that shifts dice odds will.
   */
  addModifier(context: string, modifier: (value: number) => number): void {
    this.modifiers.set(context, modifier);
  }
}

/** A fresh secret seed for a new session. */
export function newSeed(): number {
  return Math.floor(Math.random() * 4294967296);
}

/** What the randomizer needs for `Continue`: the seed and the position it had reached. */
export type RandomCursor = { seed: number; position: number };

/**
 * A fixed pseudo-random source for tests and fixtures, so a test that does not care about
 * randomness still gets a deterministic sequence. Never used by gameplay: the session's
 * `Randomizer` is the only source in the game.
 */
export function fixedRandom(seed = 0): () => number {
  const randomizer = new Randomizer(seed);
  return () => randomizer.next();
}
