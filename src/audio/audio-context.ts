/**
 * The game's one Web Audio context (#518), shared by music and synthesised sound effects, made
 * lazily on first use (browsers allow creating it any time but keep it suspended until a user
 * gesture). Nothing creates a context per sound.
 */
let shared: AudioContext | null = null;
let make: () => AudioContext = () => new AudioContext();

export function sharedAudioContext(): AudioContext {
  shared ??= make();
  return shared;
}

/** Ask a suspended context to run; harmless before a user gesture or when already running. */
export function resumeSharedAudio(): void {
  if (shared?.state === "suspended") void shared.resume().catch(() => {});
}

/** For tests: replace how the context is made, and forget any made so far. */
export function setAudioContextFactory(factory: () => AudioContext): void {
  make = factory;
  shared = null;
}
