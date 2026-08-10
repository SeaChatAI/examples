/**
 * Shared player engine surface — cloud Actor only.
 * Card bind lives in card.ts; runtime factory lives in actor-player-runtime.ts.
 */
export {
  bindCard,
  CARD,
  DEFAULT_BOUND,
  isStub,
  type BoundCard,
  type CardEnvelope,
} from './card.ts';

export {
  createEngine,
  createEngineFromSnapshot,
  actorPlayerRuntime,
  ensureActorTransport,
  playerSettingsToConfigurePatch,
  resolveGenerationTokenBudget,
} from './actor-player-runtime.ts';

export type { GenerationTokenBudget } from './engine-settings.ts';
