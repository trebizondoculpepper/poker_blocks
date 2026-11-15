/**
 * The trusted build identity for experiment artifacts (doc/experiments/configuration-compatibility.md,
 * "Build identity ownership"). It must be an opaque identity known to distinguish the actual built
 * gameplay code; `appVersion` is a display version and is never substituted for it.
 *
 * No adapter establishes one yet (dirty trees, overrides and hot reload defeat the release
 * version), so this is null and the bench reports verified replay as unavailable (#937). Supplying
 * a trusted identity is separate work.
 */
export const trustedBuildIdentity: string | null = null;

/** Why verified replay is unavailable while no trusted identity exists. */
export const buildIdentityUnavailable =
  "Verified replay is unavailable: this build has no trusted identity (exports remain inspectable).";
