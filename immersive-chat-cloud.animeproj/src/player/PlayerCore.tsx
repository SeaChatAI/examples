import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { SeaChat } from '@seachat/sdk';
import {
  getActorTransport,
  useWorldEngine,
} from '@seachat/sdk/render/render';
import {
  SessionDrawer,
} from '@seashort/card-kit/react/session-drawer';
import { DEFAULT_BOUND, isStub, type BoundCard } from './card.ts';
import { formatSeaChatError } from './errors.ts';
import type {
  ConnectPhase,
  PlayerConnection,
  PlayerEngine,
  PlayerEngineCreateOptions,
  PlayerEngineSnapshot,
  PlayerRuntime,
} from './player-runtime.ts';

import { cardHostFromSearch, deriveCardPresentation } from './card-presentation.ts';
import { chatActions } from './chat-actions.ts';
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL,
  availableChatModels,
  resolveChatModel,
  type ChatModelOption,
} from './models.ts';
import {
  actorSessionIdFromDocument,
  CloudSessionStore,
  engineSnapshotFromDocument,
  LocalSessionStore,
  prefsFromSettings,
  readPlayerSettings,
  worldIdForBound,
  type RoleWorldSessionDocument,
  type RoleWorldSessionSummary,
} from './session-store.ts';
import {
  defaultPlayerSettings,
  estimateContextUsageTokens,
  resolvePersonaForSession,
  syncPersonaToAccount,
  type PlayerSettings,
} from './session-prefs.ts';
import { useTurnPhase } from './useTurnPhase.ts';
import { ThinkingPanel } from './components/ThinkingPanel.tsx';
import {
  MemoryModelSheet,
  PersonaSheet,
  PinnedMemorySheet,
  SettingsChips,
  type SheetId,
} from './components/PlayerSettingsSheets.tsx';
import { MessageContent } from './MessageContent.tsx';
import { collectDisplayRegexScripts } from './message-display.ts';
import { whenEngineReady } from './when-engine-ready.ts';
import './styles.css';

const STUB_MODE = isStub();

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function formatMessageTime(sendDate?: number): string | null {
  if (typeof sendDate !== 'number' || !Number.isFinite(sendDate)) return null;
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(sendDate));
  } catch {
    return null;
  }
}

export interface ImmersiveChatPlayerCoreProps {
  bound?: BoundCard;
  runtime: PlayerRuntime;
  /** UI capability only. Shared mount/load gates remain defined by runtime identity. */
  supportedProtocols?: readonly string[];
}

const DEFAULT_SUPPORTED_PROTOCOLS = ['text'] as const;

export default function PlayerCore({
  bound = DEFAULT_BOUND,
  runtime,
  supportedProtocols = DEFAULT_SUPPORTED_PROTOCOLS,
}: ImmersiveChatPlayerCoreProps) {
  // Shared player: cover/assets live on ?cardHost= (card Experience), not player origin.
  const cardHost = useMemo(() => cardHostFromSearch(), []);
  const PRESENTATION = useMemo(
    () =>
      deriveCardPresentation(
        bound.envelope.data as Parameters<typeof deriveCardPresentation>[0],
        { cardHost },
      ),
    [bound, cardHost],
  );
  const PROTOCOL_SUPPORTED = supportedProtocols.includes(bound.card.protocol ?? 'text');
  /** Actor path stores only session handles; local engine keeps full snapshot SSOT. */
  const persistMode = runtime.persistMode ?? 'local-engine';
  const DISPLAY_REGEX = useMemo(
    () => collectDisplayRegexScripts(bound.card.regexScripts, bound.envelope),
    [bound],
  );

  const storeRef = useRef<LocalSessionStore | CloudSessionStore>(
    new LocalSessionStore(bound, persistMode),
  );
  const connectionRef = useRef<PlayerConnection | null>(null);
  const seaChatClientRef = useRef<SeaChat | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationControllerRef = useRef<AbortController | null>(null);
  const bootStartedRef = useRef(false);
  const modelOptionsRef = useRef<readonly ChatModelOption[]>(
    STUB_MODE ? CHAT_MODEL_OPTIONS : [DEFAULT_CHAT_MODEL],
  );
  const settingsRef = useRef<PlayerSettings>(defaultPlayerSettings(DEFAULT_CHAT_MODEL));
  const engineRef = useRef<PlayerEngine | null>(null);

  const freshEngine = useCallback(
    (
      settings: PlayerSettings = defaultPlayerSettings(),
      createOptions?: PlayerEngineCreateOptions,
    ) => {
      const next = runtime.engine.create(settings, bound, createOptions);
      runtime.engine.applyConnection(next, connectionRef.current);
      return next;
    },
    [bound, runtime],
  );

  const restoreEngine = useCallback(
    (snapshot: PlayerEngineSnapshot, settings: PlayerSettings) => {
      const next = runtime.engine.restore(snapshot, settings, bound);
      runtime.engine.applyConnection(next, connectionRef.current);
      return next;
    },
    [bound, runtime],
  );

  const [engine, setEngineState] = useState(() => {
    const initialEngine = freshEngine(settingsRef.current);
    engineRef.current = initialEngine;
    return initialEngine;
  });
  const { snapshot, streaming } = useWorldEngine(engine);
  const turn = useTurnPhase(engine);
  const actions = useMemo(() => chatActions(engine), [engine]);

  const [authed, setAuthed] = useState(false);
  const [authPhase, setAuthPhase] = useState<ConnectPhase | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationStopped, setGenerationStopped] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState<RoleWorldSessionSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<readonly ChatModelOption[]>(
    modelOptionsRef.current,
  );
  const [settings, setSettingsState] = useState<PlayerSettings>(settingsRef.current);
  const [settingsSheet, setSettingsSheet] = useState<SheetId>(null);
  const [showJump, setShowJump] = useState(false);
  /** Mobile: double-tap chat stream to hide chrome and see full art. */
  const [chatHidden, setChatHidden] = useState(false);
  const lastImmersiveTapRef = useRef(0);

  const toggleChatChrome = useCallback(() => {
    setChatHidden((value) => !value);
  }, []);

  /** Double-tap / double-click on message flow (or empty stage when hidden). */
  const handleImmersiveGesture = useCallback(
    (event: { detail?: number; timeStamp?: number }) => {
      // Mouse double-click
      if (typeof event.detail === 'number' && event.detail === 2) {
        toggleChatChrome();
        return;
      }
      // Touch double-tap (~300ms)
      const now = performance.now();
      if (now - lastImmersiveTapRef.current < 320) {
        toggleChatChrome();
        lastImmersiveTapRef.current = 0;
      } else {
        lastImmersiveTapRef.current = now;
      }
    },
    [toggleChatChrome],
  );

  const actorRequestContext = useCallback(() => {
    const token = connectionRef.current?.engineCredential;
    return typeof token === 'string' && token.trim()
      ? { bearerToken: token.trim() }
      : undefined;
  }, []);

  /** Map Actor thin rows → drawer summaries. */
  const mapActorSessionRows = useCallback(
    (
      rows: Array<{
        sessionId: string;
        worldId?: string;
        title?: string;
        updatedAt?: string;
        messageCount?: number;
        preview?: string;
      }>,
      worldId: string,
    ): RoleWorldSessionSummary[] =>
      rows.map((row) => ({
        id: row.sessionId,
        worldId: row.worldId || worldId,
        title: row.title || 'Chat',
        createdAt: row.updatedAt || new Date().toISOString(),
        updatedAt: row.updatedAt || new Date().toISOString(),
        messageCount: row.messageCount ?? 0,
        preview: row.preview ?? '',
      })),
    [],
  );

  /**
   * Ensure the live session appears even when cloud index / catalog lag.
   * Common after Actor create when list index is empty or worldId filter misses.
   */
  const withActiveSessionFallback = useCallback(
    (list: RoleWorldSessionSummary[]): RoleWorldSessionSummary[] => {
      const activeId = currentIdRef.current?.trim() || '';
      if (!activeId) return list;
      if (list.some((row) => row.id === activeId)) return list;
      const snap = engineRef.current?.getSnapshot?.() as PlayerEngineSnapshot | undefined;
      const actorId =
        typeof snap?.actorSessionId === 'string' ? snap.actorSessionId.trim() : '';
      // Prefer Actor session id (catalog id == actorSessionId after align).
      const id = actorId || activeId;
      if (list.some((row) => row.id === id)) return list;
      const messages = Array.isArray(snap?.messages) ? snap.messages : [];
      const last = messages[messages.length - 1] as { content?: unknown } | undefined;
      const preview =
        last && typeof last.content === 'string' ? last.content.slice(0, 400) : '';
      const now = new Date().toISOString();
      const synthetic: RoleWorldSessionSummary = {
        id,
        worldId: worldIdForBound(bound),
        title: 'Chat',
        createdAt: now,
        updatedAt: now,
        messageCount: messages.length,
        preview,
      };
      return [synthetic, ...list];
    },
    [bound],
  );

  const refreshSessions = useCallback(async () => {
    // Actor path: one list RTT (worldId filter). Empty → catalog fallback.
    // No second unfiltered Actor list (legacy worldId is rare; catalog/synthetic cover it).
    if (persistMode === 'actor-handle') {
      const transport = getActorTransport();
      if (transport?.listSessions) {
        try {
          const worldId = worldIdForBound(bound);
          const rows = await transport.listSessions(
            { worldId, limit: 50 },
            actorRequestContext(),
          );
          if (rows.length > 0) {
            setSessions(withActiveSessionFallback(mapActorSessionRows(rows, worldId)));
            return;
          }
        } catch (error) {
          console.warn('[role-chat] Actor list failed; falling back to catalog:', error);
        }
      }
    }
    try {
      const catalog = await storeRef.current.list();
      setSessions(withActiveSessionFallback(catalog));
    } catch (error) {
      console.warn('[role-chat] catalog list failed:', error);
      setSessions(withActiveSessionFallback([]));
    }
  }, [actorRequestContext, bound, mapActorSessionRows, persistMode, withActiveSessionFallback]);

  const clearPendingSave = useCallback(() => {
    if (!saveTimerRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  const replaceEngine = useCallback((nextEngine: ReturnType<typeof freshEngine>) => {
    engineRef.current = nextEngine;
    setEngineState(nextEngine);
  }, []);

  const applySettings = useCallback((next: PlayerSettings) => {
    const resolved: PlayerSettings = {
      ...next,
      model: resolveChatModel(next.model.id, modelOptionsRef.current),
    };
    settingsRef.current = resolved;
    setSettingsState(resolved);
    return resolved;
  }, []);

  const currentPrefs = useCallback(() => prefsFromSettings(settingsRef.current), []);

  const settingsForSession = useCallback((document: RoleWorldSessionDocument): PlayerSettings => {
    return readPlayerSettings(document, modelOptionsRef.current);
  }, []);

  /** Session meta → account kv → product default. */
  const hydrateSettings = useCallback(
    async (
      document: RoleWorldSessionDocument | null,
      client: SeaChat | null,
    ): Promise<{ settings: PlayerSettings; seededFromAccount: boolean }> => {
      const base = document
        ? settingsForSession(document)
        : {
            ...settingsRef.current,
            model: resolveChatModel(settingsRef.current.model.id, modelOptionsRef.current),
          };
      const { persona, seededFromAccount } = await resolvePersonaForSession(
        client,
        document?.metadata,
      );
      return {
        settings: applySettings({ ...base, persona }),
        seededFromAccount,
      };
    },
    [applySettings, settingsForSession],
  );

  const loadModelCatalog = useCallback(async (client: SeaChat) => {
    try {
      const catalog = await client.models.get('llm');
      const options = availableChatModels(catalog);
      modelOptionsRef.current = options;
      setModelOptions(options);
      applySettings({
        ...settingsRef.current,
        model: resolveChatModel(settingsRef.current.model.id, options),
      });
    } catch (error) {
      console.warn('[role-chat] model catalog load failed; keeping default model:', error);
      modelOptionsRef.current = [DEFAULT_CHAT_MODEL];
      setModelOptions(modelOptionsRef.current);
      applySettings({ ...settingsRef.current, model: DEFAULT_CHAT_MODEL });
    }
  }, [applySettings]);

  const activateCurrentSession = useCallback(async (): Promise<boolean> => {
    const store = storeRef.current;
    const client = seaChatClientRef.current;
    try {
      const activeId = await store.getCurrent();
      if (activeId) {
        const document = await store.get(activeId).catch(() => null);
        const catalogSnap = document ? engineSnapshotFromDocument(document) : null;
        // Actor catalog: require handle. Local/legacy: any engine object is enough.
        const canRestore =
          catalogSnap
          && (persistMode !== 'actor-handle' || actorSessionIdFromDocument(document!) !== null);
        if (document && canRestore && catalogSnap) {
          const { settings: nextSettings, seededFromAccount } = await hydrateSettings(
            document,
            client,
          );
          const nextEngine = restoreEngine(catalogSnap, nextSettings);
          const readyEngine = await whenEngineReady(nextEngine);
          // A restored remote engine GETs Actor truth first; reconcile persisted
          // player settings through the Actor's authoritative configure command.
          await runtime.engine.configure(readyEngine, nextSettings, bound);
          replaceEngine(readyEngine);
          currentIdRef.current = activeId;
          setCurrentId(activeId);
          setGenerationError(null);
          setGenerationStopped(false);
          // Catalog rewrite only when persona was seeded into session meta, or
          // local-engine needs a full snapshot. Actor-handle already has the id.
          if (seededFromAccount || persistMode !== 'actor-handle') {
            void store
              .save(activeId, readyEngine.getSnapshot(), prefsFromSettings(nextSettings))
              .catch(() => undefined);
          }
          void refreshSessions();
          return true;
        }
      }

      const { settings: nextSettings } = await hydrateSettings(null, client);
      // Prefer the engine created at mount — do not bootstrap a second Actor session.
      let nextEngine = engineRef.current;
      if (!nextEngine) {
        nextEngine = freshEngine(nextSettings);
      } else {
        runtime.engine.applyConnection(nextEngine, connectionRef.current);
      }
      if (nextEngine === engineRef.current) {
        await runtime.engine.configure(nextEngine, nextSettings, bound);
      }
      nextEngine = await whenEngineReady(nextEngine);
      const created = await store.create(
        nextEngine.getSnapshot(),
        prefsFromSettings(nextSettings),
      );
      await store.setCurrent(created.id);
      replaceEngine(nextEngine);
      currentIdRef.current = created.id;
      setCurrentId(created.id);
      setGenerationError(null);
      setGenerationStopped(false);
      void refreshSessions();
      return true;
    } catch (error) {
      // Ready/bootstrap failure must be visible; never store an empty pre-ready projection.
      setGenerationError(
        formatSeaChatError(error, 'Session engine is not ready. Retry or re-enter.'),
      );
      return false;
    }
  }, [
    bound,
    freshEngine,
    hydrateSettings,
    persistMode,
    refreshSessions,
    replaceEngine,
    restoreEngine,
    runtime,
  ]);

  const connect = useCallback(
    async (interactive: boolean): Promise<boolean> => {
      setRuntimeReady(false);
      setAuthPhase(null);
      setAuthError(null);
      try {
        const connection = await runtime.connection.connect({
          interactive,
          onPhase: setAuthPhase,
        });
        connectionRef.current = connection;
        const { seaChatClient } = connection;
        seaChatClientRef.current = seaChatClient;
        setAuthed(true);
        setAuthPhase(null);
        clearPendingSave();
        runtime.engine.applyConnection(engine, connection);
        const modelCatalogReady = loadModelCatalog(seaChatClient);

        const cloudStore = new CloudSessionStore(seaChatClient, bound, persistMode);
        const cloudCurrentId = await cloudStore.getCurrent();
        storeRef.current = cloudStore;
        if (cloudCurrentId) {
          // Model catalog is not required to GET Actor projection; overlap with restore.
          const activated = activateCurrentSession();
          await Promise.all([modelCatalogReady, activated]);
        } else {
          // Bootstrap the core Actor session as soon as identity is available.
          // Model catalog and optional persona data must not block first-world readiness.
          const readyEngine = await whenEngineReady(engine);
          await modelCatalogReady;
          const { settings: nextSettings } = await hydrateSettings(null, seaChatClient);
          await runtime.engine.configure(readyEngine, nextSettings, bound);
          const created = await cloudStore.create(
            readyEngine.getSnapshot(),
            prefsFromSettings(nextSettings),
          );
          await cloudStore.setCurrent(created.id);
          currentIdRef.current = created.id;
          setCurrentId(created.id);
          void refreshSessions();
        }
        setRuntimeReady(true);
        return true;
      } catch (error) {
        setAuthPhase(null);
        if (runtime.connection.isAuthRequiredError(error)) {
          setAuthed(false);
          connectionRef.current = null;
          seaChatClientRef.current = null;
        } else if (connectionRef.current && runtime.connection.allowUnauthenticatedBoot) {
          storeRef.current = new LocalSessionStore(bound, persistMode);
          seaChatClientRef.current = null;
          setAuthError(null);
          if (await activateCurrentSession()) {
            setRuntimeReady(true);
            return true;
          }
          setAuthError(formatSeaChatError(error, 'Could not connect to SeaChat. Please try again.'));
          return false;
        } else {
          setAuthError(formatSeaChatError(error, 'Could not connect to SeaChat. Please try again.'));
        }
        return false;
      }
    },
    [
      activateCurrentSession,
      bound,
      clearPendingSave,
      engine,
      hydrateSettings,
      loadModelCatalog,
      persistMode,
      refreshSessions,
      runtime,
    ],
  );

  useEffect(() => {
    if (bootStartedRef.current) return;
    bootStartedRef.current = true;
    void (async () => {
      if (STUB_MODE) {
        setRuntimeReady(await activateCurrentSession());
        return;
      }
      const connected = await connect(false);
      if (!connected && runtime.connection.allowUnauthenticatedBoot) {
        await activateCurrentSession();
      }
    })();
  }, [activateCurrentSession, connect, runtime]);

  useEffect(() => {
    const id = currentIdRef.current;
    if (!id || streaming || engineRef.current !== engine) return;
    clearPendingSave();
    const store = storeRef.current;
    saveTimerRef.current = setTimeout(() => {
      if (
        engineRef.current !== engine ||
        storeRef.current !== store ||
        currentIdRef.current !== id
      ) {
        return;
      }
      const snap = engine.getSnapshot();
      // Actor path: conversation SSOT is worldcompute. List chips update locally;
      // do not write seachat catalog or re-list after every turn (handle already
      // exists from create/switch; prefs write only on explicit settings change).
      if (persistMode === 'actor-handle') {
        const messages = Array.isArray(snap.messages) ? snap.messages : [];
        const last = messages[messages.length - 1] as { content?: unknown } | undefined;
        const preview =
          last && typeof last.content === 'string' ? last.content.slice(0, 400) : '';
        const now = new Date().toISOString();
        setSessions((prev) => {
          if (!prev.some((row) => row.id === id)) return prev;
          return prev.map((row) =>
            row.id === id
              ? { ...row, messageCount: messages.length, preview, updatedAt: now }
              : row,
          );
        });
        return;
      }
      store
        .save(id, snap, currentPrefs())
        .then(refreshSessions)
        .catch((error) => console.warn('[role-chat] session save failed:', error));
    }, 500);
    return clearPendingSave;
  }, [
    clearPendingSave,
    currentPrefs,
    engine,
    persistMode,
    refreshSessions,
    settings,
    snapshot.messages,
    streaming,
  ]);

  useEffect(() => {
    if (drawerOpen) void refreshSessions();
  }, [drawerOpen, refreshSessions]);

  const flowRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const flow = flowRef.current;
    if (!flow) return;
    flow.scrollTo({ top: flow.scrollHeight, behavior });
    pinnedRef.current = true;
    setShowJump(false);
  }, []);

  useEffect(() => {
    if (pinnedRef.current) scrollToLatest(streaming ? 'auto' : 'smooth');
  }, [scrollToLatest, snapshot.messages, streaming, turn.text, runtimeReady]);

  useEffect(() => {
    if (!runtimeReady || typeof window === 'undefined' || window.parent === window) return;
    window.parent.postMessage(
      { type: 'seashort-preview-runtime-ready', version: 1 },
      '*',
    );
  }, [runtimeReady]);

  // Soft-keyboard inset: iOS Safari doesn't honor `interactive-widget`, so we
  // measure how much the on-screen keyboard eats from the layout viewport via
  // visualViewport and expose it as `--kbd-inset` for the composer to clear.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const root = document.documentElement;
    const sync = () => {
      // Occluded bottom = layout height − (visible height + how far it's scrolled up).
      const occluded = window.innerHeight - vv.height - vv.offsetTop;
      root.style.setProperty('--kbd-inset', `${Math.max(0, Math.round(occluded))}px`);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      root.style.removeProperty('--kbd-inset');
    };
  }, []);

  const runGeneration = useCallback(
    async (work: (signal: AbortSignal) => Promise<void>) => {
      if (generationControllerRef.current) return;
      const controller = new AbortController();
      generationControllerRef.current = controller;
      setGenerating(true);
      setGenerationError(null);
      setGenerationStopped(false);
      try {
        await work(controller.signal);
      } catch (error) {
        if (isAbortError(error)) {
          setGenerationStopped(true);
        } else {
          setGenerationError(formatSeaChatError(error));
        }
      } finally {
        if (generationControllerRef.current === controller) generationControllerRef.current = null;
        setGenerating(false);
      }
    },
    [],
  );

  const send = useCallback(() => {
    const message = input.trim();
    if (
      !PROTOCOL_SUPPORTED
      || !runtimeReady
      || sessionBusy
      || generationError
      || generationStopped
      || !message
      || generating
      || streaming
    ) return;
    if (!authed && !STUB_MODE) {
      setAuthError(null);
      void connect(true);
      return;
    }
    setInput('');
    void runGeneration(async (signal) => {
      try {
        await engine.send(message, { signal });
      } catch (error) {
        if (runtime.connection.isGenerationAuthError(error)) {
          connectionRef.current = null;
          setAuthed(false);
          setAuthError('Session expired. Please sign in again.');
        }
        throw error;
      }
    });
  }, [
    PROTOCOL_SUPPORTED,
    authed,
    connect,
    engine,
    generating,
    generationError,
    generationStopped,
    input,
    runGeneration,
    runtimeReady,
    runtime,
    sessionBusy,
    streaming,
  ]);

  const retry = useCallback(() => {
    if (!actions.canRetry || generating || streaming) return;
    void runGeneration((signal) => actions.retry(signal));
  }, [actions, generating, runGeneration, streaming]);

  const continueReply = useCallback(() => {
    if (!actions.canContinue || generating || streaming) return;
    void runGeneration((signal) => actions.continue(signal));
  }, [actions, generating, runGeneration, streaming]);

  const backtrack = useCallback(() => {
    if (!actions.canBacktrack || generating || streaming) return;
    void runGeneration(async (signal) => {
      if (!(await actions.backtrack(signal))) {
        throw new Error('Nothing to undo in this conversation');
      }
    });
  }, [actions, generating, runGeneration, streaming]);

  const stop = () => generationControllerRef.current?.abort();

  const handleLogout = useCallback(async () => {
    runtime.connection.disconnect();
    connectionRef.current = null;
    seaChatClientRef.current = null;
    setAuthed(false);
    setRuntimeReady(false);
    setAuthError(null);
    setModelError(null);
    clearPendingSave();
    currentIdRef.current = null;
    setCurrentId(null);
    modelOptionsRef.current = [DEFAULT_CHAT_MODEL];
    setModelOptions(modelOptionsRef.current);
    applySettings(defaultPlayerSettings(DEFAULT_CHAT_MODEL));
    storeRef.current = new LocalSessionStore(bound, persistMode);
    if (STUB_MODE || runtime.connection.allowUnauthenticatedBoot) {
      setRuntimeReady(await activateCurrentSession());
    } else {
      const nextEngine = freshEngine(settingsRef.current);
      replaceEngine(nextEngine);
      setSessions(await storeRef.current.list());
    }
  }, [
    activateCurrentSession,
    applySettings,
    bound,
    clearPendingSave,
    freshEngine,
    persistMode,
    replaceEngine,
    runtime,
  ]);

  const switchSession = useCallback(
    async (id: string) => {
      if (id === currentIdRef.current) {
        setDrawerOpen(false);
        return;
      }
      setSessionBusy(true);
      try {
        const priorId = currentIdRef.current;
        const priorSnap = priorId ? engine.getSnapshot() : null;
        const prefs = currentPrefs();
        // Local-engine only: prior snapshot must hit catalog before switch.
        // Actor path: state already durable on worldcompute — skip seachat write.
        if (priorId && priorSnap && persistMode !== 'actor-handle') {
          void storeRef.current
            .save(priorId, priorSnap, prefs)
            .catch(() => undefined);
        }

        if (persistMode === 'actor-handle' && id.trim()) {
          // Critical path = Actor GET. Catalog prefs load in parallel (optional).
          // configure is a no-op RTT when prefs already match Actor projection.
          const handleSnap: PlayerEngineSnapshot = {
            actorSessionId: id.trim(),
            messages: [],
            state: {},
            options: [],
            streaming: false,
          };
          const documentPromise = storeRef.current.get(id).catch(() => null);
          const provisional = applySettings({
            ...settingsRef.current,
            model: resolveChatModel(settingsRef.current.model.id, modelOptionsRef.current),
          });
          const nextEngine = await whenEngineReady(
            restoreEngine(handleSnap, provisional),
          );
          const document = await documentPromise;
          const nextSettings = document
            ? applySettings(settingsForSession(document))
            : provisional;
          await runtime.engine.configure(nextEngine, nextSettings, bound);
          replaceEngine(nextEngine);
          currentIdRef.current = id;
          setCurrentId(id);
          setGenerationError(null);
          setGenerationStopped(false);
          setDrawerOpen(false);
          setSessionBusy(false);

          void (async () => {
            try {
              if (!document) {
                await storeRef.current.create(
                  nextEngine.getSnapshot(),
                  prefsFromSettings(nextSettings),
                ).catch(() => undefined);
              }
              await storeRef.current.setCurrent(id);
            } catch (error) {
              console.warn('[role-chat] post-switch catalog sync failed:', error);
            }
          })();
          return;
        }

        const document = await storeRef.current.get(id).catch(() => null);
        const catalogSnap = document ? engineSnapshotFromDocument(document) : null;
        if (!document || !catalogSnap) {
          setGenerationError('Missing session handle; cannot switch.');
          return;
        }
        const nextSettings = applySettings(settingsForSession(document));
        const nextEngine = await whenEngineReady(
          restoreEngine(catalogSnap, nextSettings),
        );
        await runtime.engine.configure(nextEngine, nextSettings, bound);
        replaceEngine(nextEngine);
        await storeRef.current.setCurrent(id);
        currentIdRef.current = id;
        setCurrentId(id);
        setGenerationError(null);
        setGenerationStopped(false);
        await refreshSessions();
        setDrawerOpen(false);
      } catch (error) {
        setGenerationError(
          formatSeaChatError(error, 'Could not switch session: engine not ready.'),
        );
      } finally {
        setSessionBusy(false);
      }
    },
    [
      applySettings,
      bound,
      currentPrefs,
      engine,
      persistMode,
      refreshSessions,
      replaceEngine,
      restoreEngine,
      runtime,
      settingsForSession,
    ],
  );

  const createSession = useCallback(async () => {
    setSessionBusy(true);
    try {
      const priorSnap = engine.getSnapshot();
      const priorActorId =
        typeof priorSnap.actorSessionId === 'string' ? priorSnap.actorSessionId.trim() : '';
      const priorId = currentIdRef.current;
      const prefs = currentPrefs();
      const nextSettings = applySettings({
        ...settingsRef.current,
        model: resolveChatModel(settingsRef.current.model.id, modelOptionsRef.current),
      });
      // Actor path: clone WorldSpec from current session (no full card re-upload).
      const createOptions: PlayerEngineCreateOptions | undefined =
        persistMode === 'actor-handle' && priorActorId
          ? { cloneFromSessionId: priorActorId }
          : undefined;

      // Local-engine: prior snapshot must land before new row. Actor: skip prior write.
      const savePriorPromise =
        priorId && persistMode !== 'actor-handle'
          ? storeRef.current
              .save(priorId, priorSnap!, prefs)
              .catch((error) => {
                console.warn('[role-chat] prior session catalog save failed:', error);
              })
          : Promise.resolve();

      const readyPromise = whenEngineReady(freshEngine(nextSettings, createOptions));

      if (persistMode === 'actor-handle') {
        // Critical path = one Actor clone RTT. Catalog + list are not SSOT and must
        // not serialize behind create (was ~3–5 seachat round-trips of dead wait).
        const nextEngine = await readyPromise;
        const snap = nextEngine.getSnapshot();
        const newId =
          typeof snap.actorSessionId === 'string' ? snap.actorSessionId.trim() : '';
        if (!newId) {
          throw new Error('Could not create session: Actor returned no sessionId.');
        }

        replaceEngine(nextEngine);
        currentIdRef.current = newId;
        setCurrentId(newId);
        setGenerationError(null);
        setGenerationStopped(false);

        const worldId = worldIdForBound(bound);
        const now = new Date().toISOString();
        const messages = Array.isArray(snap.messages) ? snap.messages : [];
        const last = messages[messages.length - 1] as { content?: unknown } | undefined;
        const preview =
          last && typeof last.content === 'string' ? last.content.slice(0, 400) : '';
        setSessions((prev) => [
          {
            id: newId,
            worldId,
            title: 'Chat',
            createdAt: now,
            updatedAt: now,
            messageCount: messages.length,
            preview,
          },
          ...prev.filter((row) => row.id !== newId),
        ]);
        setDrawerOpen(false);
        setSessionBusy(false);

        // Handle + current pointer only (no prior chip rewrite, no forced list).
        void (async () => {
          try {
            const created = await storeRef.current.create(
              snap,
              prefsFromSettings(nextSettings),
            );
            await storeRef.current.setCurrent(created.id);
          } catch (error) {
            console.warn('[role-chat] post-create catalog sync failed:', error);
          }
        })();
        return;
      }

      // Local engine: full snapshot is catalog SSOT — keep durable ordering.
      await savePriorPromise;
      const nextEngine = await readyPromise;
      const created = await storeRef.current.create(nextEngine.getSnapshot(), prefs);
      await storeRef.current.setCurrent(created.id);
      replaceEngine(nextEngine);
      currentIdRef.current = created.id;
      setCurrentId(created.id);
      setGenerationError(null);
      setGenerationStopped(false);
      await refreshSessions();
      setDrawerOpen(false);
    } catch (error) {
      setGenerationError(
        formatSeaChatError(error, 'Could not create session: engine not ready.'),
      );
    } finally {
      setSessionBusy(false);
    }
  }, [
    applySettings,
    bound,
    currentPrefs,
    engine,
    freshEngine,
    persistMode,
    refreshSessions,
    replaceEngine,
  ]);

  const renameSession = useCallback(
    async (id: string, title: string) => {
      await storeRef.current.rename(id, title);
      await refreshSessions();
    },
    [refreshSessions],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      setSessionBusy(true);
      try {
        // Actor path: GC cloud session first (catalog id == actorSessionId after align).
        if (persistMode === 'actor-handle') {
          const document = await storeRef.current.get(id).catch(() => null);
          const actorId =
            (document ? actorSessionIdFromDocument(document) : null) || id;
          const transport = getActorTransport();
          if (transport?.deleteSession && actorId) {
            await transport.deleteSession(actorId, actorRequestContext()).catch((error) => {
              console.warn('[role-chat] Actor delete failed:', error);
            });
          }
        }
        await storeRef.current.delete(id).catch(() => undefined);

        if (id === currentIdRef.current) {
          // Build remaining list before picking next (refreshSessions is async state).
          let remaining: RoleWorldSessionSummary[] = [];
          if (persistMode === 'actor-handle') {
            const transport = getActorTransport();
            if (transport?.listSessions) {
              try {
                const worldId = worldIdForBound(bound);
                const rows = await transport.listSessions(
                  { worldId, limit: 50 },
                  actorRequestContext(),
                );
                remaining = rows.length > 0
                  ? mapActorSessionRows(rows, worldId)
                  : await storeRef.current.list();
              } catch {
                remaining = await storeRef.current.list().catch(() => []);
              }
            } else {
              remaining = await storeRef.current.list().catch(() => []);
            }
          } else {
            remaining = await storeRef.current.list().catch(() => []);
          }

          if (remaining.length > 0) {
            const next = remaining[0]!;
            const document = await storeRef.current.get(next.id);
            const catalogSnap = document
              ? engineSnapshotFromDocument(document)
              : persistMode === 'actor-handle'
                ? ({
                    actorSessionId: next.id,
                    messages: [],
                    state: {},
                    options: [],
                    streaming: false,
                  } as PlayerEngineSnapshot)
                : null;
            const canRestore = Boolean(
              catalogSnap
              && (
                persistMode !== 'actor-handle'
                || (typeof catalogSnap.actorSessionId === 'string' && catalogSnap.actorSessionId)
              ),
            );
            const resolved = document
              ? applySettings(settingsForSession(document))
              : applySettings(defaultPlayerSettings(DEFAULT_CHAT_MODEL));
            const rawEngine = canRestore && catalogSnap
              ? restoreEngine(catalogSnap, resolved)
              : freshEngine(resolved);
            const nextEngine = await whenEngineReady(rawEngine);
            if (canRestore) {
              await runtime.engine.configure(nextEngine, resolved, bound);
            }
            replaceEngine(nextEngine);
            await storeRef.current.setCurrent(next.id);
            currentIdRef.current = next.id;
            setCurrentId(next.id);
            setSessions(remaining);
          } else {
            const nextSettings = applySettings({
              ...settingsRef.current,
              model: resolveChatModel(settingsRef.current.model.id, modelOptionsRef.current),
            });
            const nextEngine = await whenEngineReady(freshEngine(nextSettings));
            const created = await storeRef.current.create(
              nextEngine.getSnapshot(),
              prefsFromSettings(nextSettings),
            );
            await storeRef.current.setCurrent(created.id);
            replaceEngine(nextEngine);
            currentIdRef.current = created.id;
            setCurrentId(created.id);
            await refreshSessions();
          }
          setGenerationError(null);
          setGenerationStopped(false);
        } else {
          await refreshSessions();
        }
      } catch (error) {
        setGenerationError(
          formatSeaChatError(error, 'Could not switch after delete: engine not ready.'),
        );
      } finally {
        setSessionBusy(false);
      }
    },
    [
      actorRequestContext,
      applySettings,
      bound,
      freshEngine,
      mapActorSessionRows,
      persistMode,
      refreshSessions,
      replaceEngine,
      restoreEngine,
      runtime,
      settingsForSession,
    ],
  );

  const branchSession = useCallback(
    async (id: string) => {
      setSessionBusy(true);
      try {
        if (persistMode === 'actor-handle') {
          // Catalog no longer stores message history; true fork needs Actor API (slice 2+).
          throw new Error(
            'Branching is unavailable: cloud Actor does not support fork yet.',
          );
        }
        if (id === currentIdRef.current) {
          // Local engine: persist full snapshot before slicing catalog history.
          await storeRef.current.save(id, engine.getSnapshot(), currentPrefs());
        }
        const document = await storeRef.current.get(id);
        const messageCount = document?.engine
          ? ((document.engine as { messages?: unknown[] }).messages?.length ?? 0)
          : 0;
        const branch = await storeRef.current.branch(id, messageCount);
        // switchSession awaits whenEngineReady on the branched snapshot.
        await switchSession(branch.id);
      } catch (error) {
        setGenerationError(
          formatSeaChatError(error, 'Could not branch session: engine not ready.'),
        );
      } finally {
        setSessionBusy(false);
      }
    },
    [currentPrefs, engine, persistMode, switchSession],
  );

  const applyPlayerSettings = useCallback(
    async (partial: Partial<PlayerSettings>) => {
      if (modelBusy || sessionBusy || generating || streaming) return;
      setModelBusy(true);
      setModelError(null);
      clearPendingSave();
      const nextSettings = applySettings({
        ...settingsRef.current,
        ...partial,
        model: partial.model
          ? resolveChatModel(partial.model.id, modelOptionsRef.current)
          : settingsRef.current.model,
        persona: partial.persona ?? settingsRef.current.persona,
      });
      try {
        // Hot-update session prefs; keep onToken/onReasoning subscriptions and history.
        await runtime.engine.configure(engine, nextSettings, bound);
        if (currentIdRef.current) {
          // Catalog chip sync is not required to apply settings to the live Actor.
          void storeRef.current
            .save(
              currentIdRef.current,
              engine.getSnapshot(),
              prefsFromSettings(nextSettings),
            )
            .then(() => {
              if (persistMode !== 'actor-handle') return refreshSessions();
              return undefined;
            })
            .catch((error) => console.warn('[role-chat] settings catalog save failed:', error));
        }
        // v1: persona edits also write account defaults for new sessions across worlds.
        if (partial.persona) {
          void syncPersonaToAccount(seaChatClientRef.current, nextSettings.persona);
        }
      } catch (error) {
        setModelError(
          `Could not update settings: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setModelBusy(false);
        setSettingsSheet(null);
      }
    },
    [
      applySettings,
      bound,
      clearPendingSave,
      engine,
      generating,
      modelBusy,
      persistMode,
      refreshSessions,
      sessionBusy,
      streaming,
      runtime,
    ],
  );

  /**
   * Optimistic opening line from the card envelope so first_mes paints before
   * Actor whenReady/createSession. Never persisted; real projection replaces it.
   */
  const optimisticOpening = useMemo(() => {
    const data = bound.envelope?.data as { first_mes?: unknown } | undefined;
    const text = typeof data?.first_mes === 'string' ? data.first_mes.trim() : '';
    return text.length > 0 ? text : null;
  }, [bound]);

  const displayMessages = useMemo(() => {
    const msgs = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    if (msgs.length > 0) return msgs;
    if (!optimisticOpening) return msgs;
    return [{ role: 'assistant' as const, content: optimisticOpening }];
  }, [optimisticOpening, snapshot.messages]);

  const hasUserMessage = displayMessages.some((message) => message.role === 'user');
  const lastIndex = displayMessages.length - 1;
  const showLive = streaming && (turn.phase === 'thinking' || turn.phase === 'writing');
  const contextUsageTokens = estimateContextUsageTokens(snapshot.messages);
  const settingsLocked = !runtimeReady || modelBusy || sessionBusy || generating || streaming;
  const monogram = Array.from(PRESENTATION.name)[0] ?? 'C';
  const coverImage = PRESENTATION.coverUrl
    ? `url(${JSON.stringify(PRESENTATION.coverUrl)})`
    : 'none';
  const stageStyle = {
    '--accent': PRESENTATION.accent,
    '--cover-image': coverImage,
    '--cover-position': PRESENTATION.coverPosition,
  } as CSSProperties;
  const unfinishedTurn = generationStopped || generationError !== null;

  return (
    <main
      className={[
        'stage',
        PRESENTATION.coverUrl ? 'has-cover' : 'is-coverless',
        chatHidden ? 'is-chat-hidden' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={stageStyle}
    >
      {/* Tipsy PC: centered pair; mobile: full-bleed art under chat */}
      <div className="stage-frame">
        <div
          className="stage-hero"
          onClick={chatHidden ? () => toggleChatChrome() : undefined}
          role={chatHidden ? 'button' : undefined}
          tabIndex={chatHidden ? 0 : undefined}
          onKeyDown={
            chatHidden
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleChatChrome();
                  }
                }
              : undefined
          }
          aria-label={chatHidden ? 'Show chat' : undefined}
        >
          <div className="stage-hero-art" aria-hidden="true">
            {PRESENTATION.coverUrl ? (
              <img src={PRESENTATION.coverUrl} alt="" />
            ) : (
              <div className="cover-fallback">
                <span>{monogram}</span>
              </div>
            )}
          </div>
          <div className="stage-hero-veil" aria-hidden="true" />
          <div className="stage-hero-glow" aria-hidden="true" />
          <aside className="stage-hero-meta" aria-label={`${PRESENTATION.name} profile`}>
            <h1>{PRESENTATION.name}</h1>
            {PRESENTATION.tags.length > 0 && (
              <ul className="character-tags" aria-label="Character tags">
                {PRESENTATION.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            )}
            {PRESENTATION.subtitle ? (
              <p className="character-kicker">{PRESENTATION.subtitle}</p>
            ) : null}
            {PRESENTATION.description ? (
              <>
                {profileExpanded ? (
                  <p className="character-description is-expanded">{PRESENTATION.description}</p>
                ) : null}
                <button
                  type="button"
                  className="description-toggle"
                  onClick={() => setProfileExpanded((value) => !value)}
                >
                  {profileExpanded ? 'Collapse' : 'Expand profile'}
                </button>
              </>
            ) : null}
          </aside>
          {chatHidden && (
            <p className="immersive-hint" aria-hidden="true">
              Tap to show chat
            </p>
          )}
        </div>

        <div className="stage-shell">
        <section
          className="conversation"
          aria-label={`Chat with ${PRESENTATION.name}`}
          aria-hidden={chatHidden}
        >
          <header className="conversation-head">
            <button
              type="button"
              className="icon-button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open session history"
              title="Sessions"
            >
              <span aria-hidden="true">☰</span>
            </button>
            <div className="conversation-avatar" aria-hidden="true">
              {PRESENTATION.coverUrl ? (
                <img src={PRESENTATION.coverUrl} alt="" />
              ) : (
                <span>{monogram}</span>
              )}
            </div>
            <div className="conversation-identity">
              <strong>{PRESENTATION.name}</strong>
              <span>
                <i aria-hidden="true" />
                {authed ? 'Online · ready to chat' : 'Local · sign in to sync'}
              </span>
            </div>
            <div className="head-actions">
              <button type="button" className="profile-button" onClick={() => setProfileOpen(true)}>
                Profile
              </button>
              {!STUB_MODE && !authed && authPhase === null && (
                <button type="button" className="auth-button" onClick={() => void connect(true)}>
                  Sign in
                </button>
              )}
              {!STUB_MODE && authed && (
                <button type="button" className="quiet-button" onClick={() => void handleLogout()}>
                  Sign out
                </button>
              )}
            </div>
          </header>

          {(authPhase || authError) && (
            <div className={`notice ${authError ? 'is-error' : ''}`} role="status">
              {authError ??
                (authPhase === 'awaiting'
                  ? 'Authorize in SeaChat'
                  : authPhase === 'minting'
                    ? 'Issuing access token'
                    : 'Connecting to SeaChat')}
            </div>
          )}

          {modelError && (
            <div className="notice is-error" role="status">
              {modelError}
            </div>
          )}

          {!PROTOCOL_SUPPORTED && (
            <div className="notice is-error compatibility-notice" role="alert">
              This card uses the {bound.card.protocol} protocol and cannot run in the generic text chat template. Use a matching specialized template.
            </div>
          )}

          <div
            className="message-flow"
            ref={flowRef}
            onScroll={() => {
              const element = flowRef.current;
              if (!element) return;
              const pinned = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
              pinnedRef.current = pinned;
              setShowJump(!pinned);
            }}
            onDoubleClick={toggleChatChrome}
            onTouchEnd={(event) => {
              // Only count taps on the flow chrome, not interactive controls
              if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return;
              handleImmersiveGesture(event.nativeEvent);
            }}
            title="Double-click to hide/show chat"
          >
            <div className="message-column">
              {displayMessages.map((message, index) => {
                const timeLabel = formatMessageTime(
                  'sendDate' in message ? message.sendDate : undefined,
                );
                if (message.role === 'system') {
                  return <p className="system-message" key={index}>{message.content}</p>;
                }
                if (message.role === 'user') {
                  return (
                    <article className="message-row is-user msg-enter" key={index}>
                      <div className="message-user">
                        <MessageContent text={message.content} regexScripts={DISPLAY_REGEX} />
                        {timeLabel && <time dateTime={new Date(message.sendDate!).toISOString()}>{timeLabel}</time>}
                      </div>
                    </article>
                  );
                }

                const isLatest = index === lastIndex;
                // Optimistic first_mes is display-only — hide regen/backtrack until engine owns the turn.
                const engineOwned = Array.isArray(snapshot.messages) && snapshot.messages.length > 0;
                return (
                  <article
                    className={`message-row is-character msg-enter ${index === 0 ? 'is-opening' : ''}`}
                    key={index}
                  >
                    <div className="message-stack">
                      <div className="message-character">
                        <div className="message-meta">
                          <span className="message-author">{PRESENTATION.name}</span>
                          {timeLabel && (
                            <time dateTime={new Date(message.sendDate!).toISOString()}>{timeLabel}</time>
                          )}
                        </div>
                        <MessageContent text={message.content} regexScripts={DISPLAY_REGEX} />
                      </div>
                      {isLatest && hasUserMessage && !streaming && engineOwned && (
                        <div className="message-actions" aria-label="Reply actions">
                          <button
                            type="button"
                            className="message-action-icon"
                            onClick={retry}
                            disabled={!actions.canRetry || generating}
                            aria-label="Regenerate"
                            title="Regenerate"
                          >
                            <span aria-hidden="true">↻</span>
                          </button>
                          <button
                            type="button"
                            className="message-action-icon"
                            onClick={backtrack}
                            disabled={!actions.canBacktrack || generating}
                            aria-label="Undo"
                            title="Undo"
                          >
                            <span aria-hidden="true">↩</span>
                          </button>
                          <button
                            type="button"
                            className="message-action-icon"
                            onClick={continueReply}
                            disabled={!actions.canContinue || generating}
                            aria-label="Continue"
                            title="Continue"
                          >
                            <span aria-hidden="true">→</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {showLive && (
                <article className="message-row is-character is-streaming msg-enter">
                  <div className="message-stack">
                    <ThinkingPanel
                      turn={turn}
                      characterName={PRESENTATION.name}
                      thinkingLevel={settings.thinking}
                    />
                    <div className="message-character">
                      <div className="message-meta">
                        <span className="message-author">{PRESENTATION.name}</span>
                        <span className="message-live-tag">Typing</span>
                      </div>
                      {turn.phase === 'writing' && turn.text && (
                        <MessageContent
                          text={turn.text}
                          regexScripts={DISPLAY_REGEX}
                          typing
                        />
                      )}
                    </div>
                  </div>
                </article>
              )}
              {streaming && turn.phase === 'idle' && (
                <p className="waiting msg-enter" aria-label={`${PRESENTATION.name} is replying`}>
                  <span className="waiting-pulse" aria-hidden="true" />
                  Thinking of a reply…
                </p>
              )}
            </div>
          </div>

          {showJump && (
            <button
              type="button"
              className="jump-latest"
              onClick={() => scrollToLatest()}
              aria-label="Jump to latest"
              title="Jump to latest"
            >
              ↓
            </button>
          )}

          {generationError && (
            <div className="generation-error" role="alert">
              <span>{generationError}</span>
              <div className="generation-notice-actions">
                <button type="button" onClick={backtrack} disabled={!actions.canBacktrack || generating}>
                  Restore input
                </button>
                <button type="button" onClick={retry} disabled={!actions.canRetry || generating}>
                  Retry
                </button>
              </div>
            </div>
          )}

          {generationStopped && (
            <div className="generation-stopped" role="status">
              <span>Generation stopped. You can still regenerate this reply.</span>
              <div className="generation-notice-actions">
                <button type="button" onClick={backtrack} disabled={!actions.canBacktrack || generating}>
                  Restore input
                </button>
                <button type="button" onClick={retry} disabled={!actions.canRetry || generating}>
                  Regenerate
                </button>
              </div>
            </div>
          )}

          <form
            className="composer-area"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            {/* Chips outside the pill — Tipsy keeps input as a slim single bar */}
            <div className="composer-tools">
              <SettingsChips
                settings={settings}
                usageTokens={contextUsageTokens}
                disabled={settingsLocked}
                onOpen={setSettingsSheet}
              />
            </div>
            <div className="composer">
              <div className="composer-main">
                <textarea
                  value={input}
                  rows={1}
                  placeholder={
                    !PROTOCOL_SUPPORTED
                      ? 'This card protocol is not supported by this template'
                      : unfinishedTurn
                        ? 'Regenerate or restore your last input'
                      : streaming
                        ? `${PRESENTATION.name} is replying...`
                        : PRESENTATION.inputPlaceholder
                  }
                  aria-label="Message"
                  disabled={!PROTOCOL_SUPPORTED || !runtimeReady || sessionBusy || unfinishedTurn}
                  onChange={(event) => setInput(event.target.value)}
                  onInput={(event) => {
                    const target = event.currentTarget;
                    target.style.height = 'auto';
                    const next = Math.min(target.scrollHeight, 120);
                    target.style.height = `${Math.max(next, 34)}px`;
                    // Expand pill corners when multi-line
                    const pill = target.closest('.composer');
                    if (pill instanceof HTMLElement) {
                      pill.classList.toggle('is-multiline', next > 40);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
                {streaming || generating ? (
                  <button
                    type="button"
                    className="stop-button"
                    onClick={stop}
                    aria-label="Stop generation"
                    title="Stop generation"
                  >
                    <span aria-hidden="true">■</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                    disabled={
                      !PROTOCOL_SUPPORTED
                      || !runtimeReady
                      || sessionBusy
                      || unfinishedTurn
                      || !input.trim()
                    }
                    aria-label="Send message"
                    title="Send message"
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                )}
              </div>
            </div>
          </form>
        </section>
        </div>
      </div>

      <MemoryModelSheet
        open={settingsSheet === 'memory-model'}
        settings={settings}
        modelOptions={modelOptions}
        usageTokens={contextUsageTokens}
        onClose={() => setSettingsSheet(null)}
        onSave={(next) => void applyPlayerSettings(next)}
      />
      <PersonaSheet
        open={settingsSheet === 'persona'}
        persona={settings.persona}
        onClose={() => setSettingsSheet(null)}
        onSave={(persona) => void applyPlayerSettings({ persona })}
      />
      <PinnedMemorySheet
        open={settingsSheet === 'pinned'}
        value={settings.pinnedMemory}
        onClose={() => setSettingsSheet(null)}
        onSave={(pinnedMemory) => void applyPlayerSettings({ pinnedMemory })}
      />

      <SessionDrawer
        open={drawerOpen}
        sessions={sessions}
        activeId={currentId}
        busy={sessionBusy || streaming}
        onClose={() => setDrawerOpen(false)}
        onSwitch={switchSession}
        onCreate={createSession}
        onRename={renameSession}
        onDelete={deleteSession}
        onBranch={branchSession}
      />

      <div
        className={`profile-backdrop ${profileOpen ? 'is-open' : ''}`}
        onClick={() => setProfileOpen(false)}
      />
      <section
        className={`profile-sheet ${profileOpen ? 'is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Character profile"
        aria-hidden={!profileOpen}
      >
        <div className="profile-sheet-head">
          <strong>{PRESENTATION.name}</strong>
          <button type="button" onClick={() => setProfileOpen(false)} aria-label="Close profile">
            ×
          </button>
        </div>
        <p>{PRESENTATION.description}</p>
      </section>
    </main>
  );
}
