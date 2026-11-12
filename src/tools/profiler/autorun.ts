/**
 * The `devProfiler` trait's orchestration (#732; doc/automatic-profiling.md, "Composable profiler
 * trait (#669)"). Any developer room can compose it; Dev 16 is only the default host.
 *
 * Policy lives here, and capabilities stay narrow: the host supplies a sweep service that measures
 * an explicit request and returns its record, optional scene isolation, and nothing else. On
 * entry the trait captures its configuration, opens one owned run scope with a generation token
 * and, unless `autoRun` is off, starts the sweep. Run all reruns, cancelling and settling the
 * previous scope first. Exit cancels pending sampling and delivers any partial record once.
 * Records go to registered sinks named in the configuration. They are tool results, never
 * gameplay facts.
 */
import { Registry } from "../../core/registry";

/** What a sweep is asked to do: settings captured when it starts, never relabelled later. */
export type SweepRequest = {
  catalogs: readonly string[];
  counts: readonly number[];
  frames: number;
  warmupFrames: number;
  seed: number;
  timeoutMs: number;
};

/** The trait's serializable configuration. */
export type DevProfilerConfig = Partial<SweepRequest> & {
  /** Start the sweep on entry; a manual preset turns it off. */
  autoRun?: boolean;
  /** Registered result sinks, by name, that receive each record. */
  sinks?: readonly string[];
};

export const defaultSweep: SweepRequest = {
  catalogs: [],
  counts: [1, 10, 50],
  frames: 120,
  warmupFrames: 30,
  seed: 527,
  timeoutMs: 120_000,
};

/** A finished (or partial) sweep, as the trait delivers it. */
export type SweepDelivery<Record> = {
  generation: number;
  request: SweepRequest;
  record: Record;
  /** Stopped before it finished: cancelled by a rerun or by leaving the room. */
  partial: boolean;
  /** No isolation capability was available, so other rendering may have shared the frames. */
  isolated: boolean;
};

/** The narrow capabilities a hosting room provides. */
export type SweepHost<Record> = {
  /** Measure exactly this request; resolve with its record, partial if the signal fires. */
  sweep(request: SweepRequest, signal: AbortSignal): Promise<Record>;
  /** Pause competing rendering for the sweep; returns how to resume. Absent: not isolated. */
  isolate?(): () => void;
  /** Whether a record stopped before finishing for its own reasons (a cancel in the room). */
  partial?(record: Record): boolean;
};

/** A sink receives each delivery once. */
export type ResultSink<Record> = (delivery: SweepDelivery<Record>) => void;

/** Sink factories by name: the configuration names them and the trait builds one per entry. */
export const profilerResultSinks = new Registry<(host: unknown) => ResultSink<unknown>>(
  "profiler result sink",
);

type Scope = {
  generation: number;
  controller: AbortController;
  settled: Promise<void>;
};

/**
 * One trait instance's lifecycle. `sinkHost` is what sink factories are given (the room's
 * services); the scope never inspects it.
 */
export function createDevProfilerScope<Record>(host: SweepHost<Record>, sinkHost: unknown) {
  let generation = 0;
  let config: DevProfilerConfig | null = null;
  let sinks: ResultSink<Record>[] = [];
  let current: Scope | null = null;

  /** The request captured from the configuration as a run starts. */
  const requestOf = (from: DevProfilerConfig): SweepRequest => ({
    catalogs: [...(from.catalogs ?? defaultSweep.catalogs)],
    counts: [...(from.counts ?? defaultSweep.counts)],
    frames: from.frames ?? defaultSweep.frames,
    warmupFrames: from.warmupFrames ?? defaultSweep.warmupFrames,
    seed: from.seed ?? defaultSweep.seed,
    timeoutMs: from.timeoutMs ?? defaultSweep.timeoutMs,
  });

  /** Start a sweep in a fresh scope, after the previous one has been cancelled and settled. */
  async function start(): Promise<void> {
    if (!config) return;
    const previous = current;
    previous?.controller.abort();
    await previous?.settled;
    // Entered again, or left, while the previous run settled: this start is stale.
    const mine = generation;
    if (!config || current !== previous) return;
    const request = requestOf(config);
    const controller = new AbortController();
    const delivered = { done: false };
    const deliverTo = sinks;
    let release = () => {};
    const scope: Scope = {
      generation: mine,
      controller,
      settled: (async () => {
        const resume = host.isolate?.();
        release = resume ?? release;
        try {
          const record = await host.sweep(request, controller.signal);
          if (delivered.done) return;
          delivered.done = true;
          const delivery: SweepDelivery<Record> = {
            generation: mine,
            request,
            record,
            partial: controller.signal.aborted || (host.partial?.(record) ?? false),
            isolated: Boolean(resume),
          };
          // The sinks built for this entry: a later entry never receives an earlier record.
          for (const sink of deliverTo) sink(delivery);
        } finally {
          release();
        }
      })(),
    };
    current = scope;
    await scope.settled;
  }

  return {
    /** Entry: capture the configuration, build its sinks, and run unless auto-run is off. */
    enter(next: DevProfilerConfig): Promise<void> {
      generation++;
      config = { ...next };
      sinks = (next.sinks ?? []).map(
        (name) => profilerResultSinks.get(name)(sinkHost) as ResultSink<Record>,
      );
      return (next.autoRun ?? true) ? start() : Promise.resolve();
    },
    /** Run all again: cancel and settle the current run first. */
    rerun(): Promise<void> {
      return start();
    },
    /** Exit: cancel pending sampling; its partial record is delivered once to this entry's sinks. */
    async exit(): Promise<void> {
      generation++;
      config = null;
      const leaving = current;
      current = null;
      leaving?.controller.abort();
      await leaving?.settled;
    },
    /** The current entry's generation (for tests and diagnostics). */
    get generation(): number {
      return generation;
    },
  };
}

export type DevProfilerScope<Record> = ReturnType<typeof createDevProfilerScope<Record>>;
