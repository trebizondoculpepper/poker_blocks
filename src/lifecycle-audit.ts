/**
 * The registry-wide lifecycle audit (#917; doc/block-lifecycle-declarations.md): every installed
 * gameplay definition (each registered material, experimental ones included, every passive and
 * rack item, every active definition) resolves exactly one retention and reset through its
 * declared parents. A missing declaration is an error, never a hidden default. Nothing here runs
 * a boundary; that is #505/#506.
 */
import { activeDefinitions } from "./active-objects";
import { lifecycleRoots } from "./lifecycle-roots";
import {
  resolveLifecycle,
  type LifecycleDeclaration,
  type ResolvedLifecycle,
} from "./lifecycle-resolver";
import { materialPools } from "./materials";
import { passiveDefinitions } from "./passives";

/** One audited definition: its registry's name, its ID and its own declaration, if any. */
type Audited = { registry: string; id: string; declaration?: LifecycleDeclaration };

function installedDefinitions(): Audited[] {
  return [
    ...materialPools
      .get("registered")()
      .map(({ id, lifecycle }) => ({ registry: "material", id, declaration: lifecycle })),
    ...passiveDefinitions.names().map((id) => ({
      registry: "passive",
      id,
      declaration: passiveDefinitions.get(id).lifecycle,
    })),
    ...activeDefinitions.names().map((id) => ({
      registry: "active",
      id,
      declaration: activeDefinitions.get(id).lifecycle,
    })),
  ];
}

/** Each installed definition's resolved lifecycle, keyed `registry:id`, or every problem found. */
export function auditLifecycles():
  | { ok: true; resolved: Record<string, ResolvedLifecycle> }
  | { ok: false; problems: string[] } {
  const resolved: Record<string, ResolvedLifecycle> = {};
  const problems: string[] = [];
  for (const { registry, id, declaration } of installedDefinitions()) {
    const key = `${registry}:${id}`;
    // Its own declaration first; its parents are the named lifecycle roots.
    const lookup = (name: string) =>
      name === key ? declaration : (lifecycleRoots as Record<string, LifecycleDeclaration>)[name];
    try {
      resolved[key] = resolveLifecycle(key, lookup);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }
  return problems.length ? { ok: false, problems } : { ok: true, resolved };
}
