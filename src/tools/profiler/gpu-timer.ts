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
  const waiting: WebGLQuery[] = [];
  let open: WebGLQuery | null = null;
  let rejected = 0;
  return {
    available: true,
    begin() {
      if (open) return;
      open = gl.createQuery();
      if (open) gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      waiting.push(open);
      open = null;
    },
    poll() {
      const done: number[] = [];
      // A disjoint event invalidates every query in flight.
      const disjoint = Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));
      while (waiting.length) {
        const query = waiting[0]!;
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
        waiting.shift();
        const nanoseconds = Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
        gl.deleteQuery(query);
        if (disjoint || !Number.isFinite(nanoseconds) || nanoseconds <= 0) rejected++;
        else done.push(nanoseconds / 1e6);
      }
      return done;
    },
    get pending() {
      return waiting.length;
    },
    get rejected() {
      return rejected;
    },
    dispose() {
      waiting.splice(0).forEach((query) => gl.deleteQuery(query));
    },
  };
}

export function unavailableTimer(): GpuTimer {
  return {
    available: false,
    begin() {},
    end() {},
    poll: () => [],
    pending: 0,
    rejected: 0,
    dispose() {},
  };
}
