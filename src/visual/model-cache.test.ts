import * as THREE from "three";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createModelCache,
  staticPartsBlueprint,
  type ModelAsset,
  type ModelSource,
} from "./model-cache";

const asset: ModelAsset = {
  url: "/models/fan.glb",
  revision: "r1",
  profile: "staticParts",
  primary: "housing",
  parts: ["rotor"],
};

/** A parsed scene: a housing under a scaled group, a rotor part with its own transform. */
function scene() {
  const texture = new THREE.Texture();
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: texture }),
  );
  housing.name = "housing";
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
  rotor.name = "rotor";
  rotor.position.set(0, 0.5, 0);
  const root = new THREE.Group();
  root.scale.setScalar(2);
  root.add(housing, rotor);
  return { scene: root, texture, housing, rotor };
}

/** A controllable source: fetch and parse resolve when the test says. */
function source() {
  const fetches: { url: string; signal: AbortSignal; resolve(): void; reject(e: Error): void }[] =
    [];
  const parses: { resolve(parsed?: ReturnType<typeof scene>): void; reject(e: Error): void }[] = [];
  const made: ReturnType<typeof scene>[] = [];
  const src: ModelSource = {
    fetch: (url, signal) =>
      new Promise((resolve, reject) => {
        fetches.push({ url, signal, resolve: () => resolve(new ArrayBuffer(4)), reject });
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    parse: () =>
      new Promise((resolve, reject) => {
        parses.push({
          resolve: (parsed = scene()) => {
            made.push(parsed);
            resolve(parsed);
          },
          reject,
        });
      }),
  };
  return { src, fetches, parses, made };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("prepared static-model cache (#1193; doc/imported-models.md)", () => {
  it("coalesces two consumers into one preparation and one shared blueprint", async () => {
    const { src, fetches, parses } = source();
    const cache = createModelCache(src);
    const a = cache.acquire(asset);
    const b = cache.acquire(asset);
    expect(fetches).toHaveLength(1);
    fetches[0]!.resolve();
    await flush();
    parses[0]!.resolve();
    const [left, right] = await Promise.all([a.ready, b.ready]);
    expect(left).not.toBeNull();
    expect(left).toBe(right);
    expect(Object.isFrozen(left)).toBe(true);
  });

  it("keeps one consumer's preparation when another cancels", async () => {
    const { src, fetches, parses } = source();
    const cache = createModelCache(src);
    const a = cache.acquire(asset);
    const b = cache.acquire(asset);
    a.release();
    expect(fetches[0]!.signal.aborted).toBe(false);
    fetches[0]!.resolve();
    await flush();
    parses[0]!.resolve();
    expect(await a.ready).toBeNull();
    expect(await b.ready).not.toBeNull();
  });

  it("aborts the fetch when the last consumer leaves before it arrives", async () => {
    const { src, fetches } = source();
    const cache = createModelCache(src);
    const a = cache.acquire(asset);
    a.release();
    expect(fetches[0]!.signal.aborted).toBe(true);
    expect(await a.ready).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("disposes a late parse that completes after everyone left, never exposing it", async () => {
    const { src, fetches, parses, made } = source();
    const cache = createModelCache(src);
    const a = cache.acquire(asset);
    fetches[0]!.resolve();
    await flush();
    // The parse is running; the consumer leaves; the parse can't be aborted.
    a.release();
    const parsed = scene();
    const disposeGeometry = vi.spyOn(parsed.housing.geometry, "dispose");
    const disposeTexture = vi.spyOn(parsed.texture, "dispose");
    parses[0]!.resolve(parsed);
    expect(await a.ready).toBeNull();
    await flush();
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeTexture).toHaveBeenCalledTimes(1);
    expect(made).toHaveLength(1);
  });

  it("rejects on failure with a diagnostic, and the next acquire retries", async () => {
    const { src, fetches, parses } = source();
    const cache = createModelCache(src);
    const a = cache.acquire(asset);
    fetches[0]!.reject(new Error("model fetch failed: 404 /models/fan.glb"));
    await expect(a.ready).rejects.toThrow("404");
    expect(cache.size).toBe(0);
    const b = cache.acquire(asset);
    expect(fetches).toHaveLength(2);
    fetches[1]!.resolve();
    await flush();
    parses[0]!.resolve();
    expect(await b.ready).not.toBeNull();
  });

  it("disposes shared resources once, when the last lease ends", async () => {
    const { src, fetches, parses } = source();
    const cache = createModelCache(src);
    const a = cache.acquire(asset);
    const b = cache.acquire(asset);
    fetches[0]!.resolve();
    await flush();
    const parsed = scene();
    const original = vi.spyOn(parsed.housing.geometry, "dispose");
    parses[0]!.resolve(parsed);
    const blueprint = (await a.ready)!;
    // The baked primary is a copy; the parsed original is released at preparation.
    expect(blueprint.primary.geometry).not.toBe(parsed.housing.geometry);
    expect(original).toHaveBeenCalledTimes(1);
    const spies = [
      vi.spyOn(blueprint.primary.geometry, "dispose"),
      vi.spyOn(parsed.rotor.geometry, "dispose"),
      vi.spyOn(parsed.housing.material, "dispose"),
      vi.spyOn(parsed.texture, "dispose"),
    ];
    a.release();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    b.release();
    b.release();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps entries per revision: a new revision is a separate preparation", () => {
    const { src, fetches } = source();
    const cache = createModelCache(src);
    cache.acquire(asset);
    cache.acquire({ ...asset, revision: "r2" });
    expect(fetches).toHaveLength(2);
    expect(cache.size).toBe(2);
    cache.dispose();
    expect(cache.size).toBe(0);
  });
});

describe("model cache follow-ups (#1259)", () => {
  it("bakes a copy, so a geometry shared by several meshes is baked once per use", async () => {
    const { scene: root, housing } = scene();
    const twin = new THREE.Mesh(housing.geometry, housing.material);
    twin.name = "twin";
    twin.position.set(5, 0, 0);
    root.add(twin);
    const before = housing.geometry.getAttribute("position").array.slice();
    const blueprint = staticPartsBlueprint({ scene: root }, { ...asset, parts: ["rotor", "twin"] });
    expect(Array.from(housing.geometry.getAttribute("position").array)).toEqual(Array.from(before));
    expect(blueprint.parts.find(({ ref }) => ref === "twin")!.geometry).toBe(housing.geometry);
  });

  it("disposes everything parsed when validation rejects it", async () => {
    const { src, fetches, parses } = source();
    const cache = createModelCache(src);
    const lease = cache.acquire({ ...asset, parts: ["missing"] });
    fetches[0]!.resolve();
    await flush();
    const parsed = scene();
    const spies = [
      vi.spyOn(parsed.housing.geometry, "dispose"),
      vi.spyOn(parsed.rotor.geometry, "dispose"),
      vi.spyOn(parsed.texture, "dispose"),
    ];
    parses[0]!.resolve(parsed);
    await expect(lease.ready).rejects.toThrow('"missing" not found');
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps releases harmless after the cache itself is disposed", async () => {
    const { src, fetches, parses } = source();
    const cache = createModelCache(src);
    const a = cache.acquire(asset);
    const b = cache.acquire(asset);
    fetches[0]!.resolve();
    await flush();
    const parsed = scene();
    parses[0]!.resolve(parsed);
    const blueprint = (await a.ready)!;
    const spy = vi.spyOn(blueprint.primary.geometry, "dispose");
    cache.dispose();
    a.release();
    b.release();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
  });
});

describe("static-parts profile (#1193)", () => {
  it("bakes the primary mesh's hierarchy and keeps a declared part's mount transform", () => {
    const { scene: root } = scene();
    const blueprint = staticPartsBlueprint({ scene: root }, asset);
    blueprint.primary.geometry.computeBoundingBox();
    // The 1-unit housing under a ×2 group is baked to 2 units.
    expect(blueprint.primary.geometry.boundingBox!.max.x).toBeCloseTo(1);
    expect(blueprint.primary.matrix.equals(new THREE.Matrix4())).toBe(true);
    expect(blueprint.parts[0]!.ref).toBe("rotor");
    expect(new THREE.Vector3().setFromMatrixPosition(blueprint.parts[0]!.matrix).y).toBeCloseTo(1);
    expect(blueprint.bounds.max.x).toBeCloseTo(1);
  });

  it("rejects what the profile excludes, with an actionable diagnostic", () => {
    const withLight = scene();
    withLight.scene.add(new THREE.PointLight());
    expect(() => staticPartsBlueprint(withLight, asset)).toThrow("camera or light");
    expect(() => staticPartsBlueprint({ scene: scene().scene, animations: [{}] }, asset)).toThrow(
      "animation",
    );
    expect(() => staticPartsBlueprint(scene(), { ...asset, parts: ["blade"] })).toThrow(
      'manifest reference "blade" not found',
    );
  });
});
