/**
 * Shared visual simulations (#230): blocks of the same effect type show one simulation result
 * instead of each running its own. A simulation is keyed by its configuration object (a
 * material's appearance data), so every block made from that configuration shares it, and
 * nothing here names an effect or material.
 *
 * - `acquire(key, create)` returns the simulation for `key`, creating it on first use; each
 *   block that acquires one calls `release()` when it is disposed, and the simulation is
 *   dropped when no block uses it.
 * - A simulation advances at most once per frame: `step(now, ...)` ignores a second call with
 *   the same `now`, so however many blocks render it, it runs once.
 *
 * Per-block placement and orientation stay with each block; only the result is shared.
 */

export type Simulation<Input> = {
  /** Advance to `now` (seconds), once per frame however many blocks ask. */
  step(now: number, input: Input): void;
};

type Entry = { simulation: Simulation<never>; users: number };

export type SharedSimulations = {
  acquire<Input, S extends Simulation<Input>>(
    key: object,
    create: () => S,
  ): { simulation: S; release: () => void };
  /** How many distinct simulations are running: for tests and diagnostics. */
  readonly size: number;
};

export function createSharedSimulations(): SharedSimulations {
  const entries = new Map<object, Entry>();
  return {
    acquire<Input, S extends Simulation<Input>>(key: object, create: () => S) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { simulation: oncePerFrame(create()) as Simulation<never>, users: 0 };
        entries.set(key, entry);
      }
      entry.users++;
      let released = false;
      const held = entry;
      return {
        simulation: held.simulation as unknown as S,
        release: () => {
          if (released) return;
          released = true;
          held.users--;
          if (held.users === 0 && entries.get(key) === held) entries.delete(key);
        },
      };
    },
    get size() {
      return entries.size;
    },
  };
}

function oncePerFrame<Input, S extends Simulation<Input>>(simulation: S): S {
  let last: number | null = null;
  const step = simulation.step.bind(simulation);
  return Object.assign(Object.create(simulation) as S, {
    step(now: number, input: Input) {
      if (now === last) return;
      last = now;
      step(now, input);
    },
  });
}

/** The game's shared simulations: one registry for every visual effect type. */
export const sharedSimulations = createSharedSimulations();
