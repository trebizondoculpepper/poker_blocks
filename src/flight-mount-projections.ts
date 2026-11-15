/**
 * Committed facts projected onto in-flight blocks' presentation mounts (#1164;
 * doc/visual-event-interface.md, "Identity, channels and commit-side publication"). Registered by
 * the fact they handle, so the presenter dispatches without asking what happened: a material
 * change replaces the appearance channel with the captured after-snapshot (the pose keeps
 * flying), and a removal invalidates the mount so landing omits it.
 */
import type { CardBlock } from "./cards";
import { mountProjections } from "./visual-events/mount-registry";

/** Any committed change that captured the block's look after it: the appearance follows it. */
const adoptCapturedAppearance: Parameters<typeof mountProjections.register>[1] = (
  payload,
  context,
  target,
) => {
  const after = (payload as { snapshots?: { after?: CardBlock } }).snapshots?.after;
  if (target && after) context.replaceAppearance(target, after);
};

mountProjections.register("block.materialChanged", adoptCapturedAppearance);
// A reaction that changed the block's look (cooking's doneness, #1303) carries the same snapshots.
mountProjections.register("reaction.applied", adoptCapturedAppearance);

mountProjections.register("block.removed", (_payload, context, target) => {
  if (target) context.remove(target);
});
