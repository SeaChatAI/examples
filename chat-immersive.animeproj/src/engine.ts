/**
 * Thin re-export: shared runtime player + this project's card as default.
 */
import {
  bindCard,
  createEngine as createEngineBase,
  createEngineFromSnapshot as createEngineFromSnapshotBase,
  isStub,
  playerSettingsToConfigurePatch as configurePatchBase,
  resolveGenerationTokenBudget as budgetBase,
  type BoundCard,
  type CardEnvelope,
  type PlayerEngineCreateOptions,
  type PlayerSettings,
} from '@seachat/sdk/play';
import type { ActorEngineSnapshotSource } from '@seachat/sdk/render/render';
import cardEnvelope from './card.json';

export {
  bindCard,
  isStub,
  type BoundCard,
  type CardEnvelope,
} from '@seachat/sdk/play';

export const DEFAULT_BOUND = bindCard(cardEnvelope as CardEnvelope);
export const CARD = DEFAULT_BOUND.card;

export function createEngine(
  settings?: PlayerSettings,
  bound: BoundCard = DEFAULT_BOUND,
  createOptions?: PlayerEngineCreateOptions,
) {
  return createEngineBase(settings, bound, createOptions);
}

export function createEngineFromSnapshot(
  snapshot: ActorEngineSnapshotSource,
  settings?: PlayerSettings,
  bound: BoundCard = DEFAULT_BOUND,
) {
  return createEngineFromSnapshotBase(snapshot, settings, bound);
}

export function playerSettingsToConfigurePatch(
  settings: PlayerSettings,
  bound: BoundCard = DEFAULT_BOUND,
) {
  return configurePatchBase(settings, bound);
}

export function resolveGenerationTokenBudget(
  settings: PlayerSettings,
  bound: BoundCard = DEFAULT_BOUND,
) {
  return budgetBase(settings, bound);
}
