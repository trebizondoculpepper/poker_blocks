import { describe, expect, it } from "vite-plus/test";
import { SceneManager, SceneTraitRegistry, type SceneTraitBehaviour } from "./scenes";

type Traits = {
  trace: { name: string };
  second: { name: string };
  pause: { input: boolean; update: boolean };
};

function setup() {
  const calls: string[] = [];
  const behaviours = new SceneTraitRegistry<Traits, string[]>();
  behaviours.register("trace", {
    enter: (context, { name }) => context.push(`enter ${name}`),
    exit: (context, { name }) => context.push(`exit ${name}`),
    resume: (context, { name }) => context.push(`resume ${name}`),
    update: (context, { name }, dt) => context.push(`update ${name} ${dt}`),
    handles: (context, { name }, event) => {
      context.push(`handle ${name} ${String(event)}`);
      return false;
    },
  });
  behaviours.register("second", {
    enter: (context, { name }) => context.push(`enter ${name}`),
    exit: (context, { name }) => context.push(`exit ${name}`),
  });
  behaviours.register("pause", {
    blocksBelow: (_context, config, operation) =>
      operation === "input" ? config.input : config.update,
  });
  const manager = new SceneManager(behaviours, calls);
  manager.register({ id: "base", traits: { trace: { name: "base" } } });
  manager.register({
    id: "settings",
    traits: { trace: { name: "settings" }, pause: { input: true, update: true } },
  });
  manager.register({ id: "stage", traits: { trace: { name: "stage" } } });
  return { calls, manager, behaviours };
}

describe("scene manager", () => {
  it("switches scenes and enters/exits traits in composition order", () => {
    const { calls, manager } = setup();
    manager.register({
      id: "multi",
      traits: { trace: { name: "first" }, second: { name: "second" } },
    });

    manager.switchTo("base");
    manager.switchTo("multi");
    manager.switchTo("stage");

    expect(calls).toEqual([
      "enter base",
      "exit base",
      "enter first",
      "enter second",
      "exit second",
      "exit first",
      "enter stage",
    ]);
    expect(manager.current?.id).toBe("stage");
  });

  it("pushes and pops without exiting or re-entering the covered scene", () => {
    const { calls, manager } = setup();
    manager.switchTo("base");
    manager.push("settings");
    expect(manager.stack.map(({ id }) => id)).toEqual(["base", "settings"]);
    expect(manager.pop()).toBe(true);
    expect(manager.pop()).toBe(false);

    expect(calls).toEqual(["enter base", "enter settings", "exit settings", "resume base"]);
    expect(manager.current?.id).toBe("base");
  });

  it("does not duplicate a scene already at the top of the stack", () => {
    const { calls, manager } = setup();
    manager.switchTo("base");
    manager.pushIfNotCurrent("settings");
    manager.pushIfNotCurrent("settings");

    expect(manager.stack.map(({ id }) => id)).toEqual(["base", "settings"]);
    expect(calls).toEqual(["enter base", "enter settings"]);
  });

  it("stops updates and input at the nearest trait barrier", () => {
    const { calls, manager } = setup();
    manager.switchTo("base");
    manager.push("settings");

    manager.update(0.25);
    expect(manager.dispatch("Escape")).toBe(false);
    expect(calls).toEqual([
      "enter base",
      "enter settings",
      "update settings 0.25",
      "handle settings Escape",
    ]);
  });

  it("does not disturb the stack when asked to switch to an unknown scene", () => {
    const { manager } = setup();
    manager.switchTo("base");

    expect(() => manager.switchTo("missing")).toThrow('Unknown scene "missing"');
    expect(manager.current?.id).toBe("base");
  });

  it("refreshes the top scene by exiting and entering its traits, stack unchanged", () => {
    const { calls, manager } = setup();
    manager.switchTo("base");
    manager.push("settings");
    calls.length = 0;

    manager.refresh();

    // The scene re-reads whatever it shows, and no other scene is entered or exited.
    expect(calls).toEqual(["exit settings", "enter settings"]);
    expect(manager.stack.map(({ id }) => id)).toEqual(["base", "settings"]);
  });

  it("does nothing when there is no scene to refresh", () => {
    const { calls, manager } = setup();
    expect(() => manager.refresh()).not.toThrow();
    expect(calls).toEqual([]);
  });

  it("type-checks each behavior against its trait configuration", () => {
    const { behaviours } = setup();
    const invalidPauseBehaviour: SceneTraitBehaviour<string[], { unrelated: string }> = {};

    const invalidRegistration = () => {
      // @ts-expect-error the pause behavior config must match the pause trait config
      behaviours.register("pause", invalidPauseBehaviour);
    };
    expect(invalidRegistration).toBeTypeOf("function");
  });
});
