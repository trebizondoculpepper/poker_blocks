/**
 * A profiling pipeline's declared passes as data, and as a person reads them (#764). No runtime
 * imports: the one-command profiler (`scripts/profile.ts`, run by native Node) reaches this through
 * the report, so it must load without a bundler.
 */

/** One declared pass: a registered handler's name and its configuration, as plain data. */
export type PassReference = { handler: string; config?: Record<string, string | number | boolean> };

/** A pipeline as a person reads it: each pass with its configuration, then the main render. */
export function describePipeline(passes: readonly PassReference[]): string {
  const config = (values: PassReference["config"]) =>
    Object.entries(values ?? {})
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", ");
  return [
    ...passes.map(({ handler, config: values }) =>
      Object.keys(values ?? {}).length ? `${handler}(${config(values)})` : handler,
    ),
    "main render",
  ].join(" → ");
}
