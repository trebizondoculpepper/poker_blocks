/**
 * Committed facts projected onto in-flight blocks' presentation mounts (#1164;
 * doc/visual-event-interface.md, "Identity, channels and commit-side publication"). Registered by
 * the fact they handle, so the presenter dispatches without asking what happened: a material
 * change replaces the appearance channel with the captured after-snapshot (the pose keeps
 * flying), and a removal invalidates the mount so landing omits it.
 */
import type { CardBlock } from "./cards";
import { mountProjections } from "./visual-events/mount-registry";

mountProjections.register("block.materialChanged", (payload, context, target) => {
  const after = (payload as { snapshots?: { after?: CardBlock } }).snapshots?.after;
  if (target && after) context.replaceAppearance(target, after);
});

mountProjections.register("block.removed", (_payload, context, target) => {
  if (target) context.remove(target);
});
