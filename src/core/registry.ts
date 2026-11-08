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

  get(name: string): T {
    const item = this.items.get(name);
    if (item === undefined) throw new Error(`Unknown ${this.what} "${name}"`);
    return item;
  }

  has(name: string): boolean {
    return this.items.has(name);
  }

  names(): string[] {
    return [...this.items.keys()];
  }
}
