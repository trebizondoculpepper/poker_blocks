/**
 * Prepared static-model provider and renderer-scoped asset cache (#1193; doc/imported-models.md,
 * "Prepared asset provider and cache"). Loads a bundled, self-contained GLB in the validated
 * **static mesh plus explicitly named parts** profile through the installed Three.js GLTFLoader,
 * and hands consumers immutable blueprint leases over shared, cached resources.
 *
 * - **One cache per rendering context.** Create one per renderer; entries are never shared across
 *   contexts. Keys are the asset handle, revision and profile: resource handles, never behaviour.
 * - **Coalescing and leases.** Consumers of the same asset revision share one preparation and one
 *   parsed result. Each gets its own lease; releasing one never aborts another's preparation.
 * - **Cancellation.** When the last lease leaves during preparation, the fetch is aborted if it can
 *   be; a parse already running finishes and, with no consumers left, its results are disposed
 *   rather than exposed. A loader promise is never assumed to be abortable.
 * - **Failure.** A failed fetch, parse or validation rejects that entry's leases with a diagnostic
 *   and removes the entry, so the next acquire retries; nothing waits on a promise forever.
 * - **Ownership.** The cache owns the parsed geometry, textures (and their decoded images) and base
 *   materials, and disposes them exactly once when the last lease ends. A consumer clones what it
 *   mutates and disposes only its clones.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** What a definition supplies: the bundled asset and its prepared manifest. */
export type ModelAsset = {
  url: string;
  revision: string;
  profile: "staticParts";
  /** The manifest's references: the primary mesh's node name and any named part nodes. */
  primary: string;
  parts?: readonly string[];
};

/** One mesh of a blueprint: geometry baked to the model's space, its materials and its node. */
export type BlueprintMesh = {
  ref: string;
  geometry: THREE.BufferGeometry;
  materials: readonly THREE.Material[];
  /** The part's own transform within the model (identity for baked meshes). */
  matrix: THREE.Matrix4;
};

/** An immutable prepared model: shared, owned by the cache, never disposed by a consumer. */
export type Blueprint = Readonly<{
  primary: BlueprintMesh;
  parts: readonly BlueprintMesh[];
  bounds: THREE.Box3;
}>;

/** A consumer's hold on one prepared model. */
export type BlueprintLease = {
  /** Resolves with the blueprint, or null once released; rejects on failure with a diagnostic. */
  readonly ready: Promise<Blueprint | null>;
  release(): void;
};

export type ModelSource = {
  fetch(url: string, signal: AbortSignal): Promise<ArrayBuffer>;
  parse(buffer: ArrayBuffer): Promise<{ scene: THREE.Object3D; animations?: readonly unknown[] }>;
};

/** The default source: the bundled file over ordinary fetch, parsed by GLTFLoader. */
export const gltfModelSource: ModelSource = {
  fetch: (url, signal) =>
    fetch(url, { signal }).then((response) => {
      if (!response.ok) throw new Error(`model fetch failed: ${response.status} ${url}`);
      return response.arrayBuffer();
    }),
  parse: (buffer) => new GLTFLoader().parseAsync(buffer, ""),
};

/**
 * Validate a parsed scene against the static-parts profile and bake it into a blueprint: no
 * skinned meshes, cameras, lights or animation; the primary and every declared part present.
 */
export function staticPartsBlueprint(
  parsed: { scene: THREE.Object3D; animations?: readonly unknown[] },
  asset: ModelAsset,
): Blueprint {
  if (parsed.animations && parsed.animations.length > 0)
    throw new Error(`${asset.url}: animation clips are not in the static-parts profile`);
  const scene = parsed.scene;
  scene.updateMatrixWorld(true);
  const named = new Map<string, THREE.Mesh>();
  scene.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh)
      throw new Error(`${asset.url}: skinned mesh "${object.name}" is not in the profile`);
    if ((object as THREE.Camera).isCamera || (object as THREE.Light).isLight)
      throw new Error(
        `${asset.url}: hidden camera or light "${object.name}" is not in the profile`,
      );
    if ((object as THREE.Mesh).isMesh) named.set(object.name, object as THREE.Mesh);
  });
  const take = (ref: string, bake: boolean): BlueprintMesh => {
    const mesh = named.get(ref);
    if (!mesh) throw new Error(`${asset.url}: manifest reference "${ref}" not found`);
    // Static hierarchy is baked; a declared part keeps its own transform as its mount.
    const geometry = mesh.geometry;
    if (bake) geometry.applyMatrix4(mesh.matrixWorld);
    return {
      ref,
      geometry,
      materials: Object.freeze([mesh.material].flat()),
      matrix: bake ? new THREE.Matrix4() : mesh.matrixWorld.clone(),
    };
  };
  const primary = take(asset.primary, true);
  const parts = (asset.parts ?? []).map((ref) => take(ref, false));
  const bounds = new THREE.Box3();
  primary.geometry.computeBoundingBox();
  bounds.union(primary.geometry.boundingBox!);
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    bounds.union(part.geometry.boundingBox!.clone().applyMatrix4(part.matrix));
  }
  return Object.freeze({ primary, parts: Object.freeze(parts), bounds });
}

/** Free everything a blueprint holds, once: geometry, materials, textures and decoded images. */
export function disposeBlueprint(blueprint: Blueprint): void {
  const textures = new Set<THREE.Texture>();
  for (const mesh of [blueprint.primary, ...blueprint.parts]) {
    mesh.geometry.dispose();
    for (const material of mesh.materials) {
      for (const value of Object.values(material))
        if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
      material.dispose();
    }
  }
  for (const texture of textures) {
    texture.dispose();
    // A decoded ImageBitmap holds memory of its own until closed.
    (texture.image as { close?: () => void } | undefined)?.close?.();
  }
}

type Entry = {
  leases: number;
  abort: AbortController;
  result: Promise<Blueprint>;
  settled: Blueprint | null;
  disposed: boolean;
};

/** A renderer-context-owned model cache. */
export function createModelCache(source: ModelSource = gltfModelSource) {
  const entries = new Map<string, Entry>();
  const keyOf = (asset: ModelAsset) => `${asset.profile}|${asset.revision}|${asset.url}`;

  const retire = (key: string, entry: Entry) => {
    if (entries.get(key) === entry) entries.delete(key);
    entry.abort.abort();
    if (entry.settled && !entry.disposed) {
      entry.disposed = true;
      disposeBlueprint(entry.settled);
    }
  };

  return {
    acquire(asset: ModelAsset): BlueprintLease {
      const key = keyOf(asset);
      let entry = entries.get(key);
      if (!entry) {
        const abort = new AbortController();
        const created: Entry = {
          leases: 0,
          abort,
          settled: null,
          disposed: false,
          result: source
            .fetch(asset.url, abort.signal)
            .then((buffer) => source.parse(buffer))
            .then((parsed) => staticPartsBlueprint(parsed, asset))
            .then((blueprint) => {
              created.settled = blueprint;
              // Every consumer left while it prepared: dispose the late result, never expose it.
              if (created.leases === 0) retire(key, created);
              return blueprint;
            })
            .catch((error: unknown) => {
              // A failed entry is removed, so the next acquire retries.
              if (entries.get(key) === created) entries.delete(key);
              throw error instanceof Error ? error : new Error(String(error));
            }),
        };
        entries.set(key, created);
        entry = created;
      }
      const held = entry;
      held.leases += 1;
      let released = false;
      const ready = held.result.then(
        (blueprint) => (released || held.disposed ? null : blueprint),
        // A released lease never sees the abort its own release caused.
        (error: unknown) => {
          if (released) return null;
          throw error;
        },
      );
      // A lease that is never awaited must not report an unhandled rejection.
      ready.catch(() => {});
      return {
        ready,
        release() {
          if (released) return;
          released = true;
          held.leases -= 1;
          if (held.leases > 0) return;
          // Last consumer: abort what can be aborted now; a parse in flight is disposed on arrival.
          if (held.settled) retire(key, held);
          else {
            held.abort.abort();
            if (entries.get(key) === held) entries.delete(key);
          }
        },
      };
    },
    /** Prepared entries held now, for diagnostics and tests. */
    get size() {
      return entries.size;
    },
    /** The rendering context is ending: release every entry. */
    dispose() {
      for (const [key, entry] of Array.from(entries)) {
        entry.leases = 0;
        retire(key, entry);
      }
    },
  };
}

export type ModelCache = ReturnType<typeof createModelCache>;
