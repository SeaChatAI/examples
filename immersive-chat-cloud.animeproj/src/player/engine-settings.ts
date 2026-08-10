import type {
  EnginePreset,
  ActorEngineConfigurePatch,
} from '@seachat/sdk/render';
import type { BoundCard } from './card.ts';
import {
  DEFAULT_MEMORY_LIMIT,
  DEFAULT_PERSONA,
  playerPersonaToEngine,
  type PlayerSettings,
} from './session-prefs.ts';
import { thinkingLevelOption } from './models.ts';

const FALLBACK_MAX_TOKENS = 4096;
const MIN_PROMPT_TOKENS = 512;
const PRIMING_RESERVE = 3;

export interface GenerationTokenBudget {
  maxContext: number;
  maxTokens: number;
  maxPromptTokens: number;
  /** Card preset when present. Each engine supplies its own canonical default. */
  basePreset?: EnginePreset;
}

export function resolveGenerationTokenBudget(
  settings: PlayerSettings,
  bound: BoundCard,
): GenerationTokenBudget {
  const memoryLimit = Math.max(1_000, Math.floor(settings.memoryLimit || DEFAULT_MEMORY_LIMIT));
  const basePreset = bound.preset ?? undefined;
  const requestedMaxTokens =
    typeof basePreset?.openai_max_tokens === 'number'
    && Number.isFinite(basePreset.openai_max_tokens)
    && basePreset.openai_max_tokens > 0
      ? Math.floor(basePreset.openai_max_tokens)
      : FALLBACK_MAX_TOKENS;
  const catalogContextWindow =
    typeof settings.model.contextWindow === 'number'
    && Number.isFinite(settings.model.contextWindow)
    && settings.model.contextWindow > 0
      ? Math.floor(settings.model.contextWindow)
      : undefined;
  const requestedContext = memoryLimit + requestedMaxTokens;
  const maxContext = catalogContextWindow
    ? Math.min(requestedContext, catalogContextWindow)
    : requestedContext;
  const outputCapacity = Math.max(256, maxContext - MIN_PROMPT_TOKENS - PRIMING_RESERVE);
  const maxTokens = Math.min(requestedMaxTokens, outputCapacity);
  const maxPromptTokens = maxContext - maxTokens - PRIMING_RESERVE;
  return { maxContext, maxTokens, maxPromptTokens, basePreset };
}

export function playerSettingsToConfigurePatch(
  settings: PlayerSettings,
  bound: BoundCard,
): ActorEngineConfigurePatch {
  const level = thinkingLevelOption(settings.thinking);
  const { maxContext, maxTokens } = resolveGenerationTokenBudget(settings, bound);
  const persona = settings.persona ?? DEFAULT_PERSONA;
  const { userName, userPersona } = playerPersonaToEngine(persona, DEFAULT_PERSONA.name);
  const pinned = (settings.pinnedMemory ?? '').trim();
  return {
    model: settings.model.model,
    userName,
    userPersona: userPersona || null,
    pinnedMemory: pinned || null,
    config: { maxContext, maxTokens },
    sampling: { reasoningEffort: level.reasoningEffort },
    presetPatch: {
      openai_max_context: maxContext,
      openai_max_tokens: maxTokens,
      reasoning_effort: level.reasoningEffort,
    },
  };
}
