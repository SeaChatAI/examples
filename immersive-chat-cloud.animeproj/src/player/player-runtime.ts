import type {
  SeaChat,
  SeaChatBrowserAuthPhase,
  SeaChatConnectionSource,
} from '@seachat/sdk';
import type {
  ChatMessage,
  EngineSnapshotHandle,
} from '@seachat/sdk/render/render';
import type { BoundCard } from './card.ts';
import type { PlayerSettings } from './session-prefs.ts';

export type ConnectPhase = SeaChatBrowserAuthPhase;

export interface PlayerEngineSnapshot extends EngineSnapshotHandle {
  messages: ChatMessage[];
  state: Record<string, unknown>;
  options: string[];
  actorSessionId?: string;
  actorRevision?: number;
  [key: string]: unknown;
}

/** Structural UI contract for ActorEngine (product default). */
export interface PlayerEngine {
  getSnapshot(): PlayerEngineSnapshot;
  onUpdate(listener: (snapshot: PlayerEngineSnapshot) => void): () => void;
  onToken(listener: (delta: string) => void): () => void;
  onReasoning(listener: (delta: string) => void): () => void;
  send(input: string, options?: { signal?: AbortSignal }): Promise<void>;
  retryLast?(options?: { signal?: AbortSignal }): Promise<void>;
  continueLast?(options?: { signal?: AbortSignal }): Promise<void>;
  backtrackLast?(options?: { signal?: AbortSignal }): boolean | Promise<boolean>;
  whenReady?(): void | Promise<void>;
}

export interface PlayerConnection {
  seaChatClient: SeaChat;
  source: SeaChatConnectionSource;
  /** Opaque to PlayerCore: local adapter stores LLMClient; Actor adapter stores Bearer token. */
  engineCredential?: unknown;
}

/** Optional bootstrap hints for Actor engines. */
export interface PlayerEngineCreateOptions {
  /**
   * Clone WorldSpec from this Actor session when opening a *new* chat
   * (avoids re-uploading the full card).
   */
  cloneFromSessionId?: string;
}

export interface PlayerEngineAdapter {
  create(
    settings: PlayerSettings,
    bound: BoundCard,
    options?: PlayerEngineCreateOptions,
  ): PlayerEngine;
  restore(
    snapshot: PlayerEngineSnapshot,
    settings: PlayerSettings,
    bound: BoundCard,
  ): PlayerEngine;
  applyConnection(engine: PlayerEngine, connection: PlayerConnection | null): void;
  configure(engine: PlayerEngine, settings: PlayerSettings, bound: BoundCard): Promise<void>;
}

export interface PlayerConnectionAdapter {
  connect(options: {
    interactive: boolean;
    onPhase: (phase: ConnectPhase) => void;
  }): Promise<PlayerConnection>;
  disconnect(): void;
  isAuthRequiredError(error: unknown): boolean;
  isGenerationAuthError(error: unknown): boolean;
  /** Cloud Actor must not bootstrap unauthenticated (default false on actorPlayerRuntime). */
  allowUnauthenticatedBoot?: boolean;
}

/**
 * How PlayerCore writes roleWorldSessions catalog docs.
 * - `actor-handle`: only actorSessionId (+ revision) + prefs metadata; Actor is compute/state SSOT.
 * - `local-engine`: legacy full-snapshot mode (not used by product default).
 */
export type SessionPersistMode = 'local-engine' | 'actor-handle';

export interface PlayerRuntime {
  engine: PlayerEngineAdapter;
  connection: PlayerConnectionAdapter;
  /** Product default is `actor-handle`. */
  persistMode?: SessionPersistMode;
}
