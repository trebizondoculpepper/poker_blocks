/**
 * Prepared-session factories (#902; doc/experiments/trial-session-adoption.md). A composed
 * controller trait asks the run host for a new session by naming a registered factory and its
 * configuration. The host knows request IDs and the adoption mechanics; the factory knows how to
 * prepare a session; neither knows which mode or room is asking.
 */
import { Registry } from "./core/registry";
import type { PreparedSession, RunSetupStep, RunStartContext } from "./run-setup";

/** What a factory may use: prepare a session through the mode's own setup pipeline. */
export type SessionFactoryHost = {
  /** Run these start steps off to the side under the current mode's rules; draws no active RNG. */
  prepare(steps: readonly RunSetupStep[]): RunStartContext;
};

/** A registered factory: a prepared session from its configuration, or throws why not. */
export type SessionFactory = (config: unknown, host: SessionFactoryHost) => PreparedSession;
export const sessionFactories = new Registry<SessionFactory>("session factory");

/** A request for a new session: a fresh, increasing request ID, a factory and its configuration. */
export type SessionRequest = { requestId: number; factory: string; config: unknown };

/** The outcome of a request: the adopted session's provenance, or why nothing changed. */
export type SessionResult =
  | { ok: true; requestId: number; provenance: PreparedSession["provenance"] }
  | { ok: false; requestId: number; diagnostics: readonly string[] };

// A Dev scenario trial, through the registered devScenario setup step (#901).
sessionFactories.register("devScenario", (config, host) => {
  const prepared = host.prepare([
    { step: "devScenario", ...(config as object) } as RunSetupStep,
  ]).prepared;
  if (!prepared) throw new Error("the devScenario step prepared no session");
  return prepared;
});

/**
 * The request mechanics, apart from any controller: stale requests are refused, the factory is
 * dispatched by name, and only a fully prepared session reaches `adopt`. A failure adopts nothing.
 */
export function createSessionRequester(
  host: SessionFactoryHost,
  adopt: (prepared: PreparedSession) => void,
): (request: SessionRequest) => SessionResult {
  let newest = -Infinity;
  return (request) => {
    const { requestId } = request;
    if (!(requestId > newest))
      return { ok: false, requestId, diagnostics: [`request ${requestId} is stale`] };
    newest = requestId;
    let prepared: PreparedSession;
    try {
      if (!sessionFactories.has(request.factory))
        throw new Error(`unknown session factory "${request.factory}"`);
      prepared = sessionFactories.get(request.factory)(request.config, host);
    } catch (error) {
      return { ok: false, requestId, diagnostics: String((error as Error).message).split("\n") };
    }
    adopt(prepared);
    return { ok: true, requestId, provenance: prepared.provenance };
  };
}
