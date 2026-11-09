/** A scene's plain data: an id and ordered trait configurations. */
export type SceneTraitConfigs = Record<string, object>;

export type Scene<Traits extends SceneTraitConfigs = SceneTraitConfigs> = {
  readonly id: string;
  readonly traits: Partial<Traits>;
};

export type SceneOperation = "input" | "update";

/** Behaviour installed by one configured scene trait. */
export type SceneTraitBehaviour<Context, Config extends object> = {
  enter?(context: Context, config: Config): void;
  exit?(context: Context, config: Config): void;
  update?(context: Context, config: Config, dt: number): void;
  /** Return true when this trait consumes the event and stops propagation below. */
  handles?(context: Context, config: Config, event: unknown): boolean;
  /** A pausing trait can stop lower scenes receiving input or updates. */
  blocksBelow?(context: Context, config: Config, operation: SceneOperation): boolean;
};

/** Type-checked registry: each trait name is paired with its own config type. */
export class SceneTraitRegistry<Traits extends SceneTraitConfigs, Context> {
  private readonly behaviours = new Map<string, SceneTraitBehaviour<Context, object>>();

  register<Name extends keyof Traits & string>(
    name: Name,
    behaviour: SceneTraitBehaviour<Context, Traits[Name]>,
  ): void {
    if (this.behaviours.has(name)) throw new Error(`Scene trait "${name}" is already registered`);
    this.behaviours.set(name, behaviour as SceneTraitBehaviour<Context, object>);
  }

  get<Name extends keyof Traits & string>(name: Name): SceneTraitBehaviour<Context, Traits[Name]> {
    const behaviour = this.behaviours.get(name);
    if (!behaviour) throw new Error(`Unknown scene trait "${name}"`);
    return behaviour as SceneTraitBehaviour<Context, Traits[Name]>;
  }

  has(name: string): boolean {
    return this.behaviours.has(name);
  }
}

/**
 * Owns the active scene stack and runs the traits composed into each scene.
 * A push suspends the scene below without exiting it; a pop exits only the top scene.
 */
export class SceneManager<Traits extends SceneTraitConfigs, Context> {
  private readonly scenes = new Map<string, Scene<Traits>>();
  private readonly active: string[] = [];
  private readonly behaviours: SceneTraitRegistry<Traits, Context>;
  private readonly context: Context;

  constructor(behaviours: SceneTraitRegistry<Traits, Context>, context: Context) {
    this.behaviours = behaviours;
    this.context = context;
  }

  register(scene: Scene<Traits>): void {
    if (this.scenes.has(scene.id)) throw new Error(`Scene "${scene.id}" is already registered`);
    for (const name of Object.keys(scene.traits)) {
      if (!this.behaviours.has(name))
        throw new Error(`Scene "${scene.id}" uses unknown trait "${name}"`);
    }
    this.scenes.set(scene.id, scene);
  }

  get current(): Scene<Traits> | null {
    const id = this.active.at(-1);
    return id ? this.scenes.get(id)! : null;
  }

  /** The active stack from its base scene to its top scene. */
  get stack(): readonly Scene<Traits>[] {
    return this.active.map((id) => this.scenes.get(id)!);
  }

  /** Replace the entire stack with one scene. Unknown ids leave the current stack alone. */
  switchTo(id: string): void {
    const next = this.requireScene(id);
    for (let index = this.active.length - 1; index >= 0; index--) {
      this.exit(this.scenes.get(this.active[index]!)!);
    }
    this.active.length = 0;
    this.active.push(next.id);
    this.enter(next);
  }

  /** Enter a scene over the current one without exiting or re-entering the lower scene. */
  push(id: string): void {
    const next = this.requireScene(id);
    this.active.push(next.id);
    this.enter(next);
  }

  /** Push a scene only when it is not already the active top scene. */
  pushIfNotCurrent(id: string): void {
    const next = this.requireScene(id);
    if (this.active.at(-1) !== next.id) this.push(next.id);
  }

  /** Exit only the top scene; the scene underneath resumes without another enter call. */
  pop(): boolean {
    if (this.active.length < 2) return false;
    const id = this.active.at(-1)!;
    this.exit(this.scenes.get(id)!);
    this.active.pop();
    return true;
  }

  /** Update visible scenes from bottom to top, stopping below the nearest update barrier. */
  update(dt: number): void {
    let lowest = 0;
    for (let index = this.active.length - 1; index > 0; index--) {
      if (this.blocksBelow(this.scenes.get(this.active[index]!)!, "update")) {
        lowest = index;
        break;
      }
    }
    for (let index = lowest; index < this.active.length; index++) {
      const scene = this.scenes.get(this.active[index]!)!;
      for (const [name, config] of Object.entries(scene.traits)) {
        this.behaviours.get(name as keyof Traits & string).update?.(this.context, config!, dt);
      }
    }
  }

  /** Dispatch from top to bottom; a handler or input barrier stops propagation. */
  dispatch(event: unknown): boolean {
    for (let index = this.active.length - 1; index >= 0; index--) {
      const scene = this.scenes.get(this.active[index]!)!;
      for (const [name, config] of Object.entries(scene.traits)) {
        if (
          this.behaviours.get(name as keyof Traits & string).handles?.(this.context, config!, event)
        ) {
          return true;
        }
      }
      if (index > 0 && this.blocksBelow(scene, "input")) return false;
    }
    return false;
  }

  private requireScene(id: string): Scene<Traits> {
    const scene = this.scenes.get(id);
    if (!scene) throw new Error(`Unknown scene "${id}"`);
    return scene;
  }

  private enter(scene: Scene<Traits>): void {
    for (const [name, config] of Object.entries(scene.traits)) {
      this.behaviours.get(name as keyof Traits & string).enter?.(this.context, config!);
    }
  }

  private exit(scene: Scene<Traits>): void {
    for (const [name, config] of Object.entries(scene.traits).reverse()) {
      this.behaviours.get(name as keyof Traits & string).exit?.(this.context, config!);
    }
  }

  private blocksBelow(scene: Scene<Traits>, operation: SceneOperation): boolean {
    return Object.entries(scene.traits).some(([name, config]) =>
      this.behaviours
        .get(name as keyof Traits & string)
        .blocksBelow?.(this.context, config!, operation),
    );
  }
}
