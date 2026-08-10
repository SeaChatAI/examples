import {
  createLocalDataResource,
  RoleWorldSessionsResource,
  type Json,
  type RoleWorldSessionDocument,
  type RoleWorldSessionSummary,
  type SeaChat,
} from '@seachat/sdk';
import { cardIdentity } from './card-presentation.ts';
import { DEFAULT_BOUND, isStub, type BoundCard } from './card.ts';
import type {
  PlayerEngineSnapshot,
  SessionPersistMode,
} from './player-runtime.ts';
import {
  prefsFromSettings,
  type SessionPrefs,
} from './session-prefs.ts';

export type { RoleWorldSessionSummary, RoleWorldSessionDocument };
export type { SessionPrefs } from './session-prefs.ts';
export type { SessionPersistMode } from './player-runtime.ts';
export {
  readPlayerSettings,
  readSessionModel,
  readSessionThinking,
  defaultPlayerSettings,
  prefsFromSettings,
} from './session-prefs.ts';
// alias used by older call sites
export { prefsFromSettings as prefsOf } from './session-prefs.ts';

const PREVIEW_MAX = 400;

/** Session world id from the bound card (isolates 1 runtime × N cards). */
export function worldIdForBound(bound: BoundCard): string {
  return cardIdentity(bound.envelope.data as Parameters<typeof cardIdentity>[0]);
}

export function localNamespaceForBound(bound: BoundCard): string {
  return `seashort:${worldIdForBound(bound)}:${isStub() ? 'stub' : 'real'}:v1`;
}

/** @deprecated use worldIdForBound(DEFAULT_BOUND) — default dogfood card */
export const WORLD_ID = worldIdForBound(DEFAULT_BOUND);
/** @deprecated use localNamespaceForBound(DEFAULT_BOUND) */
export const LOCAL_NAMESPACE = localNamespaceForBound(DEFAULT_BOUND);

/**
 * Catalog engine payload for roleWorldSessions.
 * Actor path: handle only. Local path: full snapshot (SSOT for browser engine).
 */
export function toCatalogEngine(
  snapshot: PlayerEngineSnapshot,
  mode: SessionPersistMode,
): Json {
  if (mode === 'actor-handle') {
    const handle: Record<string, Json> = {};
    if (typeof snapshot.actorSessionId === 'string' && snapshot.actorSessionId.trim()) {
      handle.actorSessionId = snapshot.actorSessionId.trim();
    }
    if (typeof snapshot.actorRevision === 'number' && Number.isFinite(snapshot.actorRevision)) {
      handle.actorRevision = snapshot.actorRevision;
    }
    return handle;
  }
  return JSON.parse(JSON.stringify(snapshot)) as Json;
}

/** Derive list chips from a live engine snapshot (Actor projection or local). */
export function listFieldsFromSnapshot(snapshot: PlayerEngineSnapshot): {
  messageCount: number;
  preview: string;
} {
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  const last = messages[messages.length - 1];
  const content =
    last && typeof (last as { content?: unknown }).content === 'string'
      ? (last as { content: string }).content
      : '';
  return {
    messageCount: messages.length,
    preview: content.slice(0, PREVIEW_MAX),
  };
}

/**
 * Restore payload from a catalog document.
 * Accepts thin handles and legacy full blobs; ActorEngine only reads actorSessionId.
 */
export function engineSnapshotFromDocument(
  document: RoleWorldSessionDocument,
): PlayerEngineSnapshot | null {
  const raw = document.engine;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as unknown as PlayerEngineSnapshot;
}

/** Actor catalog row must carry a non-empty actorSessionId (legacy fat blob or thin handle). */
export function actorSessionIdFromDocument(
  document: RoleWorldSessionDocument,
): string | null {
  const snap = engineSnapshotFromDocument(document);
  if (!snap) return null;
  const id = snap.actorSessionId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function sessionMetadata(prefs: SessionPrefs, cardName: string) {
  return {
    cardName,
    model: prefs.model,
    thinking: prefs.thinking,
    memoryLimit: prefs.memoryLimit,
    personaName: prefs.personaName,
    personaBio: prefs.personaBio,
    personaGender: prefs.personaGender,
    pinnedMemory: prefs.pinnedMemory,
  };
}

interface SessionBackend {
  readonly persistMode: SessionPersistMode;
  list(): Promise<RoleWorldSessionSummary[]>;
  get(sessionId: string): Promise<RoleWorldSessionDocument | null>;
  create(
    snapshot: PlayerEngineSnapshot,
    prefs: SessionPrefs,
    title?: string,
  ): Promise<RoleWorldSessionDocument>;
  save(sessionId: string, snapshot: PlayerEngineSnapshot, prefs: SessionPrefs): Promise<void>;
  rename(sessionId: string, title: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
  branch(sessionId: string, atMessageIndex: number): Promise<RoleWorldSessionDocument>;
  getCurrent(): Promise<string | null>;
  setCurrent(sessionId: string): Promise<void>;
}

abstract class BaseSessionStore implements SessionBackend {
  protected abstract readonly sessions: RoleWorldSessionsResource;
  protected abstract readonly worldId: string;
  protected abstract readonly cardName: string;
  abstract readonly persistMode: SessionPersistMode;

  list(): Promise<RoleWorldSessionSummary[]> {
    return this.sessions.list(this.worldId);
  }

  get(sessionId: string): Promise<RoleWorldSessionDocument | null> {
    return this.sessions.get(sessionId, this.worldId);
  }

  async create(
    snapshot: PlayerEngineSnapshot,
    prefs: SessionPrefs,
    title?: string,
  ): Promise<RoleWorldSessionDocument> {
    if (this.persistMode === 'actor-handle') {
      const actorSessionId =
        typeof snapshot.actorSessionId === 'string' ? snapshot.actorSessionId.trim() : '';
      if (!actorSessionId) {
        throw new Error(
          'SessionStore.create (actor-handle): snapshot missing actorSessionId — await whenEngineReady first',
        );
      }
    }
    const list = listFieldsFromSnapshot(snapshot);
    // Actor path: catalog id == actorSessionId so list/delete/restore share one key.
    const actorId =
      this.persistMode === 'actor-handle'
      && typeof snapshot.actorSessionId === 'string'
        ? snapshot.actorSessionId.trim()
        : '';
    return this.sessions.create(this.worldId, {
      ...(actorId ? { id: actorId } : {}),
      ...(title ? { title } : {}),
      engine: toCatalogEngine(snapshot, this.persistMode),
      metadata: sessionMetadata(prefs, this.cardName),
      messageCount: list.messageCount,
      preview: list.preview,
    });
  }

  async save(sessionId: string, snapshot: PlayerEngineSnapshot, prefs: SessionPrefs): Promise<void> {
    if (this.persistMode === 'actor-handle') {
      const actorSessionId =
        typeof snapshot.actorSessionId === 'string' ? snapshot.actorSessionId.trim() : '';
      if (!actorSessionId) {
        // Never wipe a catalog row with an empty pre-ready handle.
        throw new Error(
          'SessionStore.save (actor-handle): snapshot missing actorSessionId — refuse empty handle write',
        );
      }
    }
    const list = listFieldsFromSnapshot(snapshot);
    await this.sessions.update(sessionId, this.worldId, {
      engine: toCatalogEngine(snapshot, this.persistMode),
      metadata: sessionMetadata(prefs, this.cardName),
      messageCount: list.messageCount,
      preview: list.preview,
    });
  }

  rename(sessionId: string, title: string): Promise<void> {
    return this.sessions.rename(sessionId, this.worldId, title);
  }

  delete(sessionId: string): Promise<void> {
    return this.sessions.delete(sessionId, this.worldId);
  }

  branch(sessionId: string, atMessageIndex: number): Promise<RoleWorldSessionDocument> {
    if (this.persistMode === 'actor-handle') {
      return Promise.reject(
        new Error(
          'Branching is unavailable: cloud Actor does not support fork yet (catalog no longer stores message slices).',
        ),
      );
    }
    return this.sessions.branch(sessionId, this.worldId, { atMessageIndex });
  }

  getCurrent(): Promise<string | null> {
    return this.sessions.getCurrent(this.worldId);
  }

  setCurrent(sessionId: string): Promise<void> {
    return this.sessions.setCurrent(this.worldId, sessionId);
  }
}

export class LocalSessionStore extends BaseSessionStore {
  protected readonly sessions: RoleWorldSessionsResource;
  protected readonly worldId: string;
  protected readonly cardName: string;
  readonly persistMode: SessionPersistMode;

  constructor(
    bound: BoundCard = DEFAULT_BOUND,
    persistMode: SessionPersistMode = 'local-engine',
  ) {
    super();
    this.worldId = worldIdForBound(bound);
    this.cardName = bound.card.name;
    this.persistMode = persistMode;
    this.sessions = new RoleWorldSessionsResource(
      createLocalDataResource({ namespace: localNamespaceForBound(bound) }),
    );
  }
}

export class CloudSessionStore extends BaseSessionStore {
  protected readonly sessions: RoleWorldSessionsResource;
  protected readonly worldId: string;
  protected readonly cardName: string;
  readonly persistMode: SessionPersistMode;

  constructor(
    client: SeaChat,
    bound: BoundCard = DEFAULT_BOUND,
    persistMode: SessionPersistMode = 'local-engine',
  ) {
    super();
    this.worldId = worldIdForBound(bound);
    this.cardName = bound.card.name;
    this.persistMode = persistMode;
    this.sessions = client.roleWorldSessions;
  }
}
