/**
 * GPU elapsed time for the profiler (#618), from EXT_disjoint_timer_query_webgl2. Queries are
 * read asynchronously (never a synchronous stall); a result taken across a disjoint event is
 * dropped. Without the extension the timer reports itself unavailable, and nothing pretends CPU
 * frame time is GPU time.
 */
export type GpuTimer = {
  readonly available: boolean;
  /** Bracket one frame's rendering. */
  begin(): void;
  end(): void;
  /** Milliseconds for every query that has finished since the last poll; disjoint ones dropped. */
  poll(): number[];
  /**
   * Drop every query now in flight without counting it: its frame belongs to whatever came
   * before (warm-up, a previous set), so it must never enter the next set's results.
   */
  discard(): void;
  /** Queries still waiting for the GPU. */
  readonly pending: number;
  /** How many results were dropped as disjoint or invalid. */
  readonly rejected: number;
  dispose(): void;
};

type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

export function createGpuTimer(gl: WebGL2RenderingContext | null): GpuTimer {
  const ext = gl?.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null;
  if (!gl || !ext) return unavailableTimer();
  /** Queries in flight, oldest first, each marked once a disjoint event spoils it. */
  const waiting: { query: WebGLQuery; spoiled: boolean; discarded: boolean }[] = [];
  let open: WebGLQuery | null = null;
  let openSpoiled = false;
  let rejected = 0;
  return {
    available: true,
    begin() {
      if (open) return;
      open = gl.createQuery();
      openSpoiled = false;
      if (open) gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      waiting.push({ query: open, spoiled: openSpoiled, discarded: false });
      open = null;
    },
    poll() {
      const done: number[] = [];
      // A disjoint event invalidates every query in flight, including ones not yet available:
      // the mark stays with each until it is collected (#625 review).
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        waiting.forEach((entry) => (entry.spoiled = true));
        openSpoiled = true;
      }
      while (waiting.length) {
        const entry = waiting[0]!;
        if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) break;
        waiting.shift();
        const nanoseconds = Number(gl.getQueryParameter(entry.query, gl.QUERY_RESULT));
        gl.deleteQuery(entry.query);
        if (entry.discarded) continue;
        if (entry.spoiled || !Number.isFinite(nanoseconds) || nanoseconds <= 0) rejected++;
        else done.push(nanoseconds / 1e6);
      }
      return done;
    },
    discard() {
      waiting.forEach((entry) => (entry.discarded = true));
      openSpoiled = true;
    },
    get pending() {
      return waiting.filter(({ discarded }) => !discarded).length;
    },
    get rejected() {
      return rejected;
    },
    dispose() {
      if (open) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        gl.deleteQuery(open);
        open = null;
      }
      waiting.splice(0).forEach(({ query }) => gl.deleteQuery(query));
    },
  };
}

export function unavailableTimer(): GpuTimer {
  return {
    available: false,
    begin() {},
    end() {},
    poll: () => [],
    discard() {},
    pending: 0,
    rejected: 0,
    dispose() {},
  };
}
