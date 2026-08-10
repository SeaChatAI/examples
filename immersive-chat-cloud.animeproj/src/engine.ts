/**
 * Embedded cloud Experience — re-export project-owned Actor player runtime.
 * Transport install stays project-local for accept scripts / vite dogfood.
 */
export {
  actorPlayerRuntime,
  createEngine,
  createEngineFromSnapshot,
  playerSettingsToConfigurePatch,
  resolveGenerationTokenBudget,
  ensureActorTransport,
} from './player/engine.ts';

import { ensureActorTransport } from './player/engine.ts';

/** Alias used by this project's main / tests. */
export function installActorTransport(): void {
  ensureActorTransport();
}
