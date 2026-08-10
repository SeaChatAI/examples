/**
 * Product default PlayerRuntime: ActorEngine → cloud worldcompute.
 * BoundCard is always injected by the caller (boot / PlayerCore / tests).
 */
import {
  ActorEngine,
  getActorTransport,
  installBrowserActorTransport,
  type ActorEngineSnapshotSource,
  type ActorEngineOptions,
} from '@seachat/sdk/render/render';
import type { BoundCard } from './card.ts';
import {
  playerSettingsToConfigurePatch as configurePatchBase,
  resolveGenerationTokenBudget as budgetBase,
} from './engine-settings.ts';
import {
  connectSeaChatIdentity,
  disconnectSeaChatIdentity,
  isSeaChatAuthRequiredError,
} from './identity-connection.ts';
import type {
  PlayerConnection,
  PlayerEngine,
  PlayerEngineSnapshot,
  PlayerRuntime,
  PlayerEngineCreateOptions,
} from './player-runtime.ts';
import type { PlayerSettings } from './session-prefs.ts';
import {
  defaultPlayerSettings,
  DEFAULT_PERSONA,
  playerPersonaToEngine,
} from './session-prefs.ts';
import {
  DEFAULT_CHAT_MODEL,
  thinkingLevelOption,
  resolveChatModel,
} from './models.ts';
import { worldIdForBound } from './session-store.ts';
import { DEFAULT_BOUND, isStub } from './card.ts';

function defaultModelOption() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return resolveChatModel(env?.VITE_WEBIDE_MODEL ?? DEFAULT_CHAT_MODEL.id);
}

function actorEngineOptions(
  settings: PlayerSettings,
  bound: BoundCard,
): ActorEngineOptions {
  const level = thinkingLevelOption(settings.thinking);
  const { maxContext, maxTokens, basePreset } = budgetBase(settings, bound);
  const persona = settings.persona ?? DEFAULT_PERSONA;
  const { userName, userPersona } = playerPersonaToEngine(persona, DEFAULT_PERSONA.name);
  const pinned = (settings.pinnedMemory ?? '').trim();
  const envMeta = (
    import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }
  ).env;
  const isDev = envMeta?.DEV === true;
  const query = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null;
  // Published builds are always live. Stub is dev-only (?stub / VITE_LLM_MODE / mount stub flag).
  const wantStub = isDev && (
    envMeta?.VITE_LLM_MODE === 'stub'
    || (typeof process !== 'undefined' && process.env.LLM_MODE === 'stub')
    || query?.has('stub') === true
    || isStub()
  );
  const llmMode: 'live' | 'stub' = wantStub ? 'stub' : 'live';
  const requestedStubDelay = Number(query?.get('stubDelayMs') ?? 0);
  const stubChunkDelayMs = Number.isFinite(requestedStubDelay)
    ? Math.max(0, Math.min(2_000, Math.floor(requestedStubDelay)))
    : 0;

  return {
    model: settings.model.model,
    userName,
    userPersona: userPersona || undefined,
    pinnedMemory: pinned || undefined,
    ...(basePreset
      ? {
          preset: {
            ...basePreset,
            reasoning_effort: level.reasoningEffort,
            openai_max_context: maxContext,
            openai_max_tokens: maxTokens,
          },
        }
      : {}),
    presetCharacterId: bound.presetCharacterId,
    allowWIScan: true,
    config: { maxContext, maxTokens },
    worldId: worldIdForBound(bound),
    llmMode,
    ...(llmMode === 'stub' && stubChunkDelayMs > 0 ? { stubChunkDelayMs } : {}),
  };
}

/** Idempotent — safe from createEngine and boot paths. */
export function ensureActorTransport(): void {
  if (!getActorTransport()) installBrowserActorTransport();
}

export function createEngine(
  settings: PlayerSettings = defaultPlayerSettings(defaultModelOption()),
  bound: BoundCard = DEFAULT_BOUND,
  createOptions?: PlayerEngineCreateOptions,
): ActorEngine {
  ensureActorTransport();
  return new ActorEngine(bound.card, {
    ...actorEngineOptions(settings, bound),
    ...(createOptions?.cloneFromSessionId
      ? { cloneFromSessionId: createOptions.cloneFromSessionId }
      : {}),
  });
}

export function createEngineFromSnapshot(
  snapshot: ActorEngineSnapshotSource,
  settings: PlayerSettings = defaultPlayerSettings(defaultModelOption()),
  bound: BoundCard = DEFAULT_BOUND,
): ActorEngine {
  ensureActorTransport();
  return ActorEngine.fromSnapshot(
    bound.card,
    snapshot,
    actorEngineOptions(settings, bound),
  );
}

function asActorEngine(engine: PlayerEngine): ActorEngine {
  return engine as unknown as ActorEngine;
}

function isActorAuthError(error: unknown): boolean {
  const status = error && typeof error === 'object'
    ? (error as { status?: unknown }).status
    : undefined;
  return status === 401 || /login|credential|unauthori[sz]ed/i.test(
    error instanceof Error ? error.message : '',
  );
}

/** Default shared / immersive PlayerRuntime — cloud Actor is compute + state SSOT. */
export const actorPlayerRuntime: PlayerRuntime = {
  persistMode: 'actor-handle',
  engine: {
    create(settings, bound, options) {
      return createEngine(settings, bound, options) as unknown as PlayerEngine;
    },
    restore(snapshot: PlayerEngineSnapshot, settings, bound) {
      return createEngineFromSnapshot(
        snapshot as ActorEngineSnapshotSource,
        settings,
        bound,
      ) as unknown as PlayerEngine;
    },
    applyConnection(engine: PlayerEngine, connection: PlayerConnection | null) {
      const token = typeof connection?.engineCredential === 'string'
        ? connection.engineCredential
        : null;
      asActorEngine(engine).setActorAuthorization(token);
    },
    configure(engine, settings, bound) {
      return asActorEngine(engine).configure(configurePatchBase(settings, bound));
    },
  },
  connection: {
    async connect(options) {
      const identity = await connectSeaChatIdentity(options);
      return {
        seaChatClient: identity.seaChatClient,
        source: identity.source,
        engineCredential: identity.actorAuthorization,
      };
    },
    disconnect: disconnectSeaChatIdentity,
    isAuthRequiredError: isSeaChatAuthRequiredError,
    isGenerationAuthError: isActorAuthError,
    allowUnauthenticatedBoot: false,
  },
};

export {
  playerSettingsToConfigurePatch,
  resolveGenerationTokenBudget,
} from './engine-settings.ts';
