import { countOperation } from "../lifecycle/operations";

/** A named collection of definitions (traits, effects, ...). Names are unique. */
export class Registry<T> {
  private readonly items = new Map<string, T>();
  private readonly what: string;

  constructor(what: string) {
    this.what = what;
  }

  register(name: string, item: T): void {
    if (this.items.has(name)) throw new Error(`${this.what} "${name}" is already registered`);
    this.items.set(name, item);
  }

  /**
   * The registered item. Inside a committed action each lookup is charged to its operation budget
   * (#661 review): registered handlers are what an action's work is made of, so every registry
   * (triggers, removals, reactions and any added later) shares the one action-wide limit.
   * Outside an action nothing is charged.
   */
  get(name: string): T {
    const item = this.items.get(name);
    if (item === undefined) throw new Error(`Unknown ${this.what} "${name}"`);
    countOperation(`${this.what} ${name}`);
    return item;
  }

  has(name: string): boolean {
    return this.items.has(name);
  }

  names(): string[] {
    return [...this.items.keys()];
  }
}
