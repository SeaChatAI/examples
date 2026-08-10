/**
 * Optional readiness seam for engines whose construction is async
 * (e.g. probe ActorEngine that boots a Rust Actor session).
 *
 * Canonical WorldEngine is sync-ready and has no `whenReady` — this helper
 * is a pure duck-type await and must not import probe types.
 */

/** Minimal surface we recognize without coupling to a concrete engine class. */
export type EngineReadiness = {
  whenReady?: () => void | Promise<void>;
};

/**
 * Await engine readiness when the instance exposes `whenReady`.
 * Canonical engines (no method) resolve immediately with the same reference.
 *
 * @throws if `whenReady` rejects — callers must surface the error and must
 *   not persist a pre-ready snapshot.
 */
export async function whenEngineReady<T extends object>(engine: T): Promise<T> {
  const ready = (engine as EngineReadiness).whenReady;
  if (typeof ready === 'function') {
    await ready.call(engine);
  }
  return engine;
}
