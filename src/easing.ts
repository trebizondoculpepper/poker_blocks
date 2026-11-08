export type Easing = (progress: number) => number;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

export const easeInOutCubic: Easing = (progress) =>
  progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;

export function tweenValue(
  from: number,
  to: number,
  elapsedSeconds: number,
  durationSeconds: number,
  easing: Easing = easeInOutCubic,
): number {
  const progress = durationSeconds <= 0 ? 1 : clamp01(elapsedSeconds / durationSeconds);
  if (progress === 0) return from;
  if (progress === 1) return to;
  return lerp(from, to, easing(progress));
}
