import { afterEach, describe, expect, test } from 'bun:test';
import {
  ActorRevisionConflictError,
  ActorEngine,
  assertPureCommand,
  setActorTransport,
  type ActorCommandRequest,
  type ActorCreateSessionRequest,
  type ActorGetSessionResponse,
  type ActorProjection,
  type ActorTransport,
  type ChatMessage,
  type ActorEngineSnapshotSource,
} from '@seachat/sdk/render/render';
import {
  createEngine,
  createEngineFromSnapshot,
  playerSettingsToConfigurePatch,
  resolveGenerationTokenBudget,
} from '../src/engine.ts';
import { resolveChatModel } from '../src/player/models.ts';
import { defaultPlayerSettings } from '../src/player/session-prefs.ts';
import { BOUND, CARD, cardEnvelope } from './project-card.ts';

type SessionState = {
  revision: number;
  projection: ActorProjection;
  pendingUser?: string;
};

function greetingProjection(): ActorProjection {
  return {
    messages: [
      {
        role: 'assistant',
        name: CARD.name,
        content: cardEnvelope.data.first_mes as string,
      },
    ],
    state: {},
    options: [],
  };
}

function createMockActorTransport(): ActorTransport & {
  sessions: Map<string, SessionState>;
  lastCommands: ActorCommandRequest[];
  createBodies: ActorCreateSessionRequest[];
} {
  const sessions = new Map<string, SessionState>();
  const lastCommands: ActorCommandRequest[] = [];
  const createBodies: ActorCreateSessionRequest[] = [];
  let seq = 0;

  const transport: ActorTransport & {
    sessions: Map<string, SessionState>;
    lastCommands: ActorCommandRequest[];
    createBodies: ActorCreateSessionRequest[];
  } = {
    sessions,
    lastCommands,
    createBodies,
    async createSession(body) {
      createBodies.push(structuredClone(body));
      const sessionId = body.sessionId ?? `mock-session-${++seq}`;
      const projection: ActorProjection = {
        ...greetingProjection(),
        userName: body.userName ?? 'User',
        userPersona: body.userPersona ?? null,
        pinnedMemory: body.pinnedMemory ?? null,
        model: structuredClone(body.model),
        config: structuredClone(body.config),
        preset: structuredClone(body.preset ?? {}),
        allowWIScan: body.allowWIScan ?? true,
      };
      sessions.set(sessionId, { revision: 1, projection });
      return { sessionId, revision: 1, projection };
    },
    async getSession(sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return null;
      return {
        sessionId,
        revision: s.revision,
        projection: structuredClone(s.projection),
      } satisfies ActorGetSessionResponse;
    },
    async postCommand(sessionId, body, signal) {
      lastCommands.push(structuredClone(body));
      assertPureCommand(body);
      const s = sessions.get(sessionId);
      if (!s) {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }
      if (body.expectedRevision !== s.revision && body.kind !== 'abort') {
        const failed = [
          'event: turn.failed',
          `data: ${JSON.stringify({
            type: 'turn.failed',
            revision: s.revision,
            projection: s.projection,
            error: 'revision conflict',
          })}`,
          '',
          '',
        ].join('\n');
        return new Response(failed, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      if (body.kind === 'abort') {
        const sse = [
          'event: turn.committed',
          `data: ${JSON.stringify({
            type: 'turn.committed',
            revision: s.revision,
            projection: s.projection,
          })}`,
          '',
          '',
        ].join('\n');
        return new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      if (body.kind === 'configure') {
        const input = body.input ?? {};
        s.revision += 1;
        s.projection = {
          ...s.projection,
          ...(input.model
            ? { model: { ...(s.projection.model ?? { model: '' }), model: input.model } }
            : {}),
          ...(input.config
            ? { config: { ...(s.projection.config ?? { maxContext: 1, maxTokens: 1 }), ...input.config } }
            : {}),
          ...(input.userName !== undefined ? { userName: input.userName } : {}),
          ...(input.userPersona !== undefined ? { userPersona: input.userPersona } : {}),
          ...(input.pinnedMemory !== undefined ? { pinnedMemory: input.pinnedMemory } : {}),
          ...(input.allowWIScan !== undefined ? { allowWIScan: input.allowWIScan } : {}),
          ...(input.presetPatch
            ? { preset: { ...(s.projection.preset ?? {}), ...input.presetPatch } }
            : {}),
        };
        const sse = [
          'event: turn.committed',
          `data: ${JSON.stringify({
            type: 'turn.committed',
            revision: s.revision,
            projection: s.projection,
            events: [{ type: 'configure', changed: true }],
          })}`,
          '',
          '',
        ].join('\n');
        return new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      if (body.kind === 'send' && body.input?.text) {
        s.pendingUser = body.input.text;
      }

      const userText = s.pendingUser ?? '(retry)';
      const assistantText =
        body.kind === 'continue'
          ? '(continue) She looked at you again.'
          : `She glanced at you. /*${userText.slice(0, 24)}*/`;

      const nextMessages: ChatMessage[] = [
        ...s.projection.messages,
        ...(body.kind === 'send' && body.input?.text
          ? [{ role: 'user' as const, content: body.input.text, name: 'You' }]
          : []),
      ];
      if (body.kind === 'retry') {
        while (nextMessages.length && nextMessages.at(-1)?.role === 'assistant') {
          nextMessages.pop();
        }
      }
      if (body.kind === 'backtrack') {
        while (nextMessages.length && nextMessages.at(-1)?.role === 'assistant') nextMessages.pop();
        while (nextMessages.length && nextMessages.at(-1)?.role === 'user') nextMessages.pop();
        s.revision += 1;
        s.projection = { ...s.projection, messages: nextMessages };
        const sse = [
          'event: turn.committed',
          `data: ${JSON.stringify({
            type: 'turn.committed',
            revision: s.revision,
            projection: s.projection,
          })}`,
          '',
          '',
        ].join('\n');
        return new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }

      nextMessages.push({
        role: 'assistant',
        name: CARD.name,
        content: assistantText,
      });
      s.revision += 1;
      s.projection = { ...s.projection, messages: nextMessages };
      s.pendingUser = undefined;

      const lines: string[] = [
        'event: turn.started',
        'data: {"type":"turn.started"}',
        '',
        'event: text.delta',
        `data: ${JSON.stringify({ type: 'text.delta', delta: 'She looked' })}`,
        '',
        'event: turn.committed',
        `data: ${JSON.stringify({
          type: 'turn.committed',
          revision: s.revision,
          projection: s.projection,
        })}`,
        '',
        '',
      ];
      const bodyText = lines.join('\n');

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          if (signal?.aborted) {
            controller.error(new DOMException('The operation was aborted.', 'AbortError'));
            return;
          }
          const onAbort = () => {
            controller.error(new DOMException('The operation was aborted.', 'AbortError'));
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          // Slow stream so abort can race
          setTimeout(() => {
            try {
              if (signal?.aborted) {
                controller.error(new DOMException('The operation was aborted.', 'AbortError'));
                return;
              }
              controller.enqueue(enc.encode(bodyText));
              controller.close();
            } catch {
              /* already aborted */
            }
          }, body.kind === 'send' ? 40 : 0);
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    },
  };
  return transport;
}

afterEach(() => {
  setActorTransport(null);
});

describe('direct ccv3 ActorEngine', () => {
  test('converts the card envelope without a template runtime facade', () => {
    expect(CARD.name).toBe(cardEnvelope.data.name);
    // b9408ca04: bare regex_scripts stay 'text' (display/storage shaping).
    expect(CARD.protocol).toBe('text');
    expect(CARD.firstMessage).toBe(cardEnvelope.data.first_mes);
    expect(CARD.worldInfo).toHaveLength(7);
    expect(CARD.regexScripts.map((script) => script.id)).toEqual([
      'actor-prompt-wrap-latest-user',
      'actor-storage-marker',
      'actor-world-info-marker',
      'render-strip-maintext-tags',
      'render-status-block-heading',
    ]);
  });

  test('constructor performs zero network (lazy bootstrap)', () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = createEngine(defaultPlayerSettings(resolveChatModel('deepseek-v4-flash')), BOUND);
    // getSnapshot must not bootstrap
    expect(engine.getSnapshot().messages).toEqual([]);
    expect(mock.createBodies.length).toBe(0);
    expect(mock.sessions.size).toBe(0);
  });

  test('two concurrent whenReady share one create/get', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const eng = new ActorEngine(CARD, {
      model: 'deepseek-v4-flash',
      config: { maxContext: 64000, maxTokens: 32000 },
      llmMode: 'stub',
      worldId: 'lazy-once',
    });
    expect(mock.createBodies.length).toBe(0);
    await Promise.all([eng.whenReady(), eng.whenReady()]);
    expect(mock.createBodies.length).toBe(1);
  });

  test('create session JSON uses camelCase model object + config shape', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = new ActorEngine(CARD, {
      model: 'deepseek-v4-flash',
      config: { maxContext: 64000, maxTokens: 32000 },
      llmMode: 'stub',
    });
    await engine.whenReady();
    expect(mock.createBodies.length).toBe(1);
    const body = mock.createBodies[0]!;
    expect(body.model).toEqual(
      expect.objectContaining({
        model: 'deepseek-v4-flash',
        maxTokens: expect.any(Number),
      }),
    );
    expect(typeof body.model).toBe('object');
    expect(body.config).toEqual(
      expect.objectContaining({
        maxContext: expect.any(Number),
        maxTokens: expect.any(Number),
      }),
    );
    // b9408ca04: bare regex_scripts stay 'text' (display/storage shaping).
    expect(body.card.protocol).toBe('text');
    expect(body.card.regexScripts).toHaveLength(5);
    expect(body.worldInfo).toHaveLength(7);
    expect(body.preset?.prompts?.length).toBeGreaterThan(0);
    expect(body.preset?.prompt_order?.length).toBeGreaterThan(0);
    // no snake_case drift on wire config keys
    expect(JSON.stringify(body.config)).not.toContain('max_context');
    expect(JSON.stringify(body.config)).not.toContain('max_tokens');
  });

  test('configure before bootstrap folds into create worldSpec without a command', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.configure({
      model: 'pre-ready-model',
      userName: 'Pre Ready',
      pinnedMemory: 'pre-ready-pin',
      config: { maxContext: 48_000, maxTokens: 777 },
    });
    expect(mock.lastCommands).toHaveLength(0);
    await engine.whenReady();
    expect(mock.createBodies[0]).toMatchObject({
      userName: 'Pre Ready',
      pinnedMemory: 'pre-ready-pin',
      model: { model: 'pre-ready-model', maxTokens: 777 },
      config: { maxContext: 48_000, maxTokens: 777 },
    });
  });

  test('configure before preferred-session restore GETs Actor truth then persists patch', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);

    const original = new ActorEngine(CARD, { llmMode: 'stub' });
    await original.whenReady();
    const sessionId = original.getSnapshot().actorSessionId;
    expect(sessionId).toBeTruthy();
    const createCount = mock.createBodies.length;
    mock.lastCommands.length = 0;

    const restored = new ActorEngine(CARD, {
      llmMode: 'stub',
      preferredSessionId: sessionId,
    });
    await restored.configure({
      model: 'restored-model',
      userName: 'Restored User',
      pinnedMemory: 'restored pin',
    });

    expect(mock.createBodies).toHaveLength(createCount);
    expect(mock.lastCommands).toHaveLength(1);
    expect(mock.lastCommands[0]).toMatchObject({
      kind: 'configure',
      input: {
        model: 'restored-model',
        userName: 'Restored User',
        pinnedMemory: 'restored pin',
      },
    });
    expect(restored.getSnapshot().actorSessionId).toBe(sessionId);
    expect(restored.getModel()).toBe('restored-model');
    expect(restored.getUserName()).toBe('Restored User');
  });

  test('configure after bootstrap is a persisted pure command and getters follow Actor projection', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.whenReady();
    mock.lastCommands.length = 0;

    await engine.configure({
      model: 'actor-model',
      userName: 'Actor User',
      userPersona: 'Actor persona',
      pinnedMemory: 'Actor pin',
      allowWIScan: false,
      config: { maxContext: 64_000, maxTokens: 888 },
      sampling: { temperature: 0.3, topP: 0.7, reasoningEffort: 'high' },
    });

    const command = mock.lastCommands.at(-1);
    expect(command?.kind).toBe('configure');
    expect(command?.input).toMatchObject({
      model: 'actor-model',
      userName: 'Actor User',
      userPersona: 'Actor persona',
      pinnedMemory: 'Actor pin',
      allowWIScan: false,
      config: { maxContext: 64_000, maxTokens: 888 },
      presetPatch: { temperature: 0.3, top_p: 0.7 },
    });
    // reasoning_effort is omitted when it already matches the engine baseline (diff-only wire).
    expect(command?.input?.presetPatch).not.toHaveProperty('reasoning_effort');
    expect(() => assertPureCommand(command!)).not.toThrow();
    expect(engine.getSnapshot().actorRevision).toBe(2);
    expect(engine.getModel()).toBe('actor-model');
    expect(engine.getConfig()).toMatchObject({ maxContext: 64_000, maxTokens: 888 });
    expect(engine.getUserName()).toBe('Actor User');
    expect(engine.getUserPersona()).toBe('Actor persona');

    // Identical re-apply (restore/switch pattern) must not spend another command RTT.
    mock.lastCommands.length = 0;
    await engine.configure({
      model: 'actor-model',
      userName: 'Actor User',
      userPersona: 'Actor persona',
      pinnedMemory: 'Actor pin',
      allowWIScan: false,
      config: { maxContext: 64_000, maxTokens: 888 },
      sampling: { temperature: 0.3, topP: 0.7, reasoningEffort: 'high' },
    });
    expect(mock.lastCommands).toHaveLength(0);
    expect(engine.getPinnedMemory()).toBe('Actor pin');
    expect(engine.getSnapshot().streaming).toBe(false);
  });

  test('?stub create uses llmMode stub; default without query uses live', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);

    const stubEng = new ActorEngine(CARD, {
      llmMode: 'stub',
      worldId: 'mode-stub',
    });
    await stubEng.whenReady();
    expect(mock.createBodies.at(-1)?.llmMode).toBe('stub');

    const liveEng = new ActorEngine(CARD, {
      llmMode: 'live',
      worldId: 'mode-live',
    });
    // live may still create against mock (mock does not reject live)
    await liveEng.whenReady();
    expect(mock.createBodies.at(-1)?.llmMode).toBe('live');

    // default options.llmMode omitted → live
    const defEng = new ActorEngine(CARD, {
      worldId: 'mode-default',
    });
    await defEng.whenReady();
    expect(mock.createBodies.at(-1)?.llmMode).toBe('live');
  });

  test('new engines create distinct Actor sessions after whenReady', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const a = new ActorEngine(CARD, { llmMode: 'stub', worldId: 'a' });
    const b = new ActorEngine(CARD, { llmMode: 'stub', worldId: 'b' });
    expect(mock.createBodies.length).toBe(0);
    await a.whenReady();
    await b.whenReady();
    expect(a.getSnapshot().actorSessionId).toBeTruthy();
    expect(b.getSnapshot().actorSessionId).toBeTruthy();
    expect(a.getSnapshot().actorSessionId).not.toBe(b.getSnapshot().actorSessionId);
    expect(mock.createBodies.length).toBe(2);
  });

  test('first send auto-bootstraps without prior whenReady', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    expect(mock.createBodies.length).toBe(0);
    await engine.send('You paused just now.');
    expect(mock.createBodies.length).toBe(1);
    expect(engine.getSnapshot().messages.at(-2)).toMatchObject({
      role: 'user',
      content: 'You paused just now.',
    });
  });

  test('streams a complete turn through Actor commands (no chatStream)', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.whenReady();
    const before = engine.getSnapshot().messages;
    expect(before.at(-1)?.content).toBe(cardEnvelope.data.first_mes);

    await engine.send('You paused just now.');

    const after = engine.getSnapshot();
    expect(after.streaming).toBe(false);
    expect(after.messages.at(-2)).toMatchObject({ role: 'user', content: 'You paused just now.' });
    expect(after.messages.at(-1)?.role).toBe('assistant');
    expect(mock.lastCommands.some((c) => c.kind === 'send')).toBe(true);
  });

  test('user text containing "card" is still sent (key-based guard, not string scan)', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.send('please show the "card" field');
    const send = mock.lastCommands.find((c) => c.kind === 'send');
    expect(send?.input?.text).toBe('please show the "card" field');
    expect(() => assertPureCommand(send!)).not.toThrow();
  });

  test('backtrack sends pure command without keepMessages', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.send('one');
    mock.lastCommands.length = 0;
    expect(await engine.backtrackLast()).toBe(true);
    const bt = mock.lastCommands.find((c) => c.kind === 'backtrack');
    expect(bt).toBeTruthy();
    expect(Object.keys(bt!)).toEqual(['commandId', 'expectedRevision', 'kind']);
    expect(JSON.stringify(bt)).not.toContain('keepMessages');
  });

  test('abort during generation posts a second abort HTTP command without snapshot', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.whenReady();
    const controller = new AbortController();
    const pending = engine.send('Hold on a second.', { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);

    let error: unknown;
    try {
      await pending;
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    const kinds = mock.lastCommands.map((c) => c.kind);
    expect(kinds).toContain('send');
    expect(kinds).toContain('abort');
    const abortCmd = mock.lastCommands.find((c) => c.kind === 'abort')!;
    expect(Object.keys(abortCmd)).toEqual(['commandId', 'expectedRevision', 'kind']);
    expect(JSON.stringify(abortCmd)).not.toContain('snapshot');
    expect(engine.getSnapshot().streaming).toBe(false);
  });

  test('abort before command response still posts Actor abort outside SSE loop', async () => {
    const commands: ActorCommandRequest[] = [];
    let revision = 1;
    let projection = greetingProjection();
    const transport: ActorTransport = {
      async createSession() {
        return { sessionId: 'slow-connect', revision, projection };
      },
      async getSession(sessionId) {
        return { sessionId, revision, projection };
      },
      async postCommand(_sessionId, body, signal) {
        commands.push(structuredClone(body));
        if (body.kind === 'abort') {
          revision = 2;
          projection = {
            ...projection,
            messages: [
              ...projection.messages,
              { role: 'user', name: 'User', content: 'stop before response' },
            ],
          };
          return new Response(
            [
              'event: turn.committed',
              `data: ${JSON.stringify({
                type: 'turn.committed',
                revision,
                projection,
              })}`,
              '',
              '',
            ].join('\n'),
            { headers: { 'Content-Type': 'text/event-stream' } },
          );
        }
        return await new Promise<Response>((_resolve, reject) => {
          const onAbort = () => reject(new DOMException('aborted before response', 'AbortError'));
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
    };
    setActorTransport(transport);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.whenReady();

    const controller = new AbortController();
    const pending = engine.send('stop before response', { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    expect(commands.map((command) => command.kind)).toEqual(['send', 'abort']);
    expect(engine.getSnapshot().actorRevision).toBe(2);
    expect(engine.getSnapshot().messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'stop before response',
    });
    expect(engine.getSnapshot().streaming).toBe(false);
  });

  test('public abortTurn works while generationInFlight', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.whenReady();
    const pending = engine.send('long turn');
    await engine.abortTurn();
    await pending.catch(() => {});
    expect(mock.lastCommands.some((c) => c.kind === 'abort')).toBe(true);
  });

  test('fromSnapshot constructor zero GET; whenReady GETs preferred actor id', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const first = new ActorEngine(CARD, { llmMode: 'stub' });
    await first.whenReady();
    await first.send('First message.');
    const snap = first.getSnapshot();
    expect(snap.actorSessionId).toBeTruthy();
    const createsAfterFirst = mock.createBodies.length;
    const getCountBefore = mock.sessions.size;

    const poisoned: ActorEngineSnapshotSource = {
      ...snap,
      messages: [{ role: 'system', content: 'POISON' }],
      state: { evil: 1 },
    };
    const restored = createEngineFromSnapshot(poisoned, defaultPlayerSettings(resolveChatModel('deepseek-v4-flash')), BOUND);
    // Constructor: no network
    expect(mock.createBodies.length).toBe(createsAfterFirst);
    expect(restored.getSnapshot().messages).toEqual([]);

    await restored.whenReady();
    const messages = restored.getSnapshot().messages.map((m) => m.content);
    expect(messages).not.toContain('POISON');
    expect(restored.getSnapshot().state).not.toEqual({ evil: 1 });
    // Should GET existing session, not create another for same id
    expect(restored.getSnapshot().actorSessionId).toBe(snap.actorSessionId);
    expect(mock.createBodies.length).toBe(createsAfterFirst);
    void getCountBefore;
  });

  test('projects state/options/events/timedWorldInfo/pendingActivateLore + display lastRender', async () => {
    const stateDeltas: Record<string, unknown>[] = [];
    const events: Array<{ type: string }> = [];
    const transport: ActorTransport = {
      async createSession() {
        return {
          sessionId: 'proj-1',
          revision: 1,
          projection: {
            messages: [{ role: 'assistant', content: 'hi', name: 'A' }],
            state: { trust: 1 },
            options: [],
            timedWorldInfo: { sticky: { '1': 3 }, cooldown: {}, delay: {} },
            pendingActivateLore: [],
          },
        };
      },
      async getSession() {
        return null;
      },
      async postCommand(_id, body) {
        assertPureCommand(body);
        const sse = [
          'event: turn.committed',
          `data: ${JSON.stringify({
            type: 'turn.committed',
            revision: 2,
            projection: {
              messages: [
                { role: 'assistant', content: 'hi', name: 'A' },
                { role: 'user', content: body.input?.text ?? '', name: 'U' },
                { role: 'assistant', content: 'SECRET <ui>', name: 'A' },
              ],
              state: { trust: 3, mood: 'happy' },
              options: ['Go', 'Stay'],
              timedWorldInfo: { sticky: { '1': 2 }, cooldown: { '9': 1 }, delay: {} },
              pendingActivateLore: ['2'],
            },
            events: [{ type: 'spark', payload: { level: 1 } }],
          })}`,
          '',
          '',
        ].join('\n');
        return new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    };
    setActorTransport(transport);
    const card = {
      ...CARD,
      regexScripts: [
        {
          id: 'display-ai',
          scriptName: 'display',
          findRegex: '/<ui>/g',
          replaceString: '<strong>UI</strong>',
          placement: [2],
          markdownOnly: true,
        },
      ],
    };
    const engine = new ActorEngine(card, {
      llmMode: 'stub',
      hooks: {
        onStateChanged(delta) {
          stateDeltas.push({ ...delta });
        },
      },
    });
    engine.onEvent((e) => events.push(e as { type: string }));
    await engine.send('ping');
    const snap = engine.getSnapshot();
    expect(snap.state).toEqual({ trust: 3, mood: 'happy' });
    expect(snap.options).toEqual(['Go', 'Stay']);
    expect(snap.pendingActivateLore).toEqual(['2']);
    expect((snap.timedWorldInfo as { sticky?: object })?.sticky).toEqual({ '1': 2 });
    expect(snap.lastRender?.html).toContain('<strong>UI</strong>');
    expect(events.some((e) => e.type === 'spark')).toBe(true);
    expect(stateDeltas.some((d) => d.trust === 3)).toBe(true);
  });

  test('HTTP 409 conflict resyncs and throws ActorRevisionConflictError', async () => {
    let getCount = 0;
    const transport: ActorTransport = {
      async createSession() {
        return {
          sessionId: 'c-1',
          revision: 5,
          projection: {
            messages: [{ role: 'assistant', content: 'hi', name: 'A' }],
            state: {},
            options: [],
          },
        };
      },
      async getSession() {
        getCount += 1;
        return {
          sessionId: 'c-1',
          revision: 6,
          projection: {
            messages: [
              { role: 'assistant', content: 'hi', name: 'A' },
              { role: 'user', content: 'other', name: 'U' },
            ],
            state: { trust: 1 },
            options: [],
          },
        };
      },
      async postCommand() {
        const err = new Error('Actor command failed (409): revision conflict') as Error & {
          status: number;
        };
        err.status = 409;
        throw err;
      },
    };
    setActorTransport(transport);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.whenReady();
    let caught: unknown;
    try {
      await engine.send('stale');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ActorRevisionConflictError);
    expect(getCount).toBeGreaterThanOrEqual(1);
    expect(engine.getSnapshot().actorRevision).toBe(6);
    expect(engine.getSnapshot().state.trust).toBe(1);
  });

  test('create forwards stubReplies on worldSpec only', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const eng = new ActorEngine(CARD, {
      llmMode: 'stub',
      stubReplies: ['A', 'B'],
    });
    await eng.whenReady();
    expect(mock.createBodies[0]?.stubReplies).toEqual(['A', 'B']);
    expect(mock.createBodies[0]?.llmMode).toBe('stub');
  });

  test('create forwards scanDepth/recursive/maxRecursionSteps/useGroupScoring', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const eng = new ActorEngine(CARD, {
      llmMode: 'stub',
      scanDepth: 12,
      recursive: true,
      maxRecursionSteps: 3,
      useGroupScoring: true,
    });
    await eng.whenReady();
    expect(mock.createBodies[0]).toMatchObject({
      scanDepth: 12,
      recursive: true,
      maxRecursionSteps: 3,
      useGroupScoring: true,
    });
  });

  test('retryLast/continueLast forward quietPrompt/bias as pure input', async () => {
    const mock = createMockActorTransport();
    setActorTransport(mock);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.whenReady();
    await engine.send('seed');
    mock.lastCommands.length = 0;
    await engine.retryLast({ quietPrompt: 'q-retry', bias: 'b-retry' });
    const retry = mock.lastCommands.find((c) => c.kind === 'retry');
    expect(retry).toBeTruthy();
    expect(retry?.input).toEqual({ quietPrompt: 'q-retry', bias: 'b-retry' });
    expect(Object.keys(retry!)).toEqual(
      expect.arrayContaining(['commandId', 'expectedRevision', 'kind', 'input']),
    );
    expect(JSON.stringify(retry)).not.toContain('snapshot');
    mock.lastCommands.length = 0;
    await engine.continueLast({ quietPrompt: 'q-cont' });
    const cont = mock.lastCommands.find((c) => c.kind === 'continue');
    expect(cont?.input).toEqual({ quietPrompt: 'q-cont' });
    expect(() => assertPureCommand(cont!)).not.toThrow();
  });

  test('normalizeState drops bool/object (no String invent)', async () => {
    const transport: ActorTransport = {
      async createSession() {
        return {
          sessionId: 'ns-1',
          revision: 1,
          projection: {
            messages: [{ role: 'assistant', content: 'hi', name: 'A' }],
            state: {
              trust: 3,
              mood: 'calm',
              flag: true as unknown as string,
              nested: { x: 1 } as unknown as string,
            },
            options: [],
            pendingActivateLore: ['2', 3 as unknown as string],
            localVariables: { a: 1 },
            globalVariables: { b: 'g' },
            lastReasoning: 'think',
          },
        };
      },
      async getSession() {
        return null;
      },
      async postCommand() {
        throw new Error('unused');
      },
    };
    setActorTransport(transport);
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.whenReady();
    const snap = engine.getSnapshot();
    expect(snap.state).toEqual({ trust: 3, mood: 'calm' });
    expect(snap.pendingActivateLore).toEqual(['2']);
    expect(snap.localVariables).toEqual({ a: 1 });
    expect(snap.globalVariables).toEqual({ b: 'g' });
    expect(snap.lastReasoning).toBe('think');
  });

  test('treats memory depth as prompt space config (presentation budget helpers)', () => {
    const settings = defaultPlayerSettings(resolveChatModel('deepseek-v4-flash'));
    const budget = resolveGenerationTokenBudget(settings, BOUND);
    expect(budget.maxContext).toBe(settings.memoryLimit + budget.maxTokens);
    expect(budget.maxTokens).toBe(budget.basePreset?.openai_max_tokens);
    expect(budget.maxPromptTokens).toBe(budget.maxContext - budget.maxTokens - 3);
    expect(playerSettingsToConfigurePatch(settings, BOUND)).toMatchObject({
      config: { maxContext: budget.maxContext, maxTokens: budget.maxTokens },
    });
  });

  test('caps combined prompt and response space to the live model context window', () => {
    const model = {
      ...resolveChatModel('deepseek-v4-pro'),
      contextWindow: 40_000,
    };
    // memoryLimit large enough that + preset maxTokens always exceeds the window
    // (independent of card openai_max_tokens tuning for Flash).
    const budget = resolveGenerationTokenBudget({
      ...defaultPlayerSettings(model),
      memoryLimit: 39_500,
    }, BOUND);
    expect(budget.maxContext).toBe(model.contextWindow);
    expect(budget.maxTokens).toBe(budget.basePreset?.openai_max_tokens);
    expect(budget.maxPromptTokens).toBe(budget.maxContext - budget.maxTokens - 3);
  });

  test('resolves newly curated SeaChat product models', () => {
    for (const id of [
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'grok-4.5',
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
    ] as const) {
      const option = resolveChatModel(id);
      expect(option.id).toBe(id);
      expect(option.model).toBe(id);
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});
