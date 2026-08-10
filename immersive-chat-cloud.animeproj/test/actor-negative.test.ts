/**
 * Negative gates for this embedded Experience:
 * - no local TS LLM transport / vendor shadow
 * - pure commands only
 * - Authorization is transport-only
 * - production bundle has no local orchestration call-sites
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ActorEngine,
  assertPureCommand,
  setActorTransport,
  type ActorCommandRequest,
  type ActorCreateSessionRequest,
  type ActorTransport,
} from '@seachat/sdk/render/render';
import { CARD } from './project-card.ts';
import { browserActorTransport } from '../src/actor-transport.ts';

const ROOT = join(import.meta.dir, '..');

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

afterEach(() => {
  setActorTransport(null);
});

describe('Actor negative gates', () => {
  test('Experience has no vendor shadow or TypeScript LLM transport', () => {
    expect(existsSync(join(ROOT, 'vendor/world-engine/package.json'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/actor-turn.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'public/catalog'))).toBe(false);
    const engine = readFileSync(join(ROOT, 'src/engine.ts'), 'utf8');
    const main = readFileSync(join(ROOT, 'src/main.tsx'), 'utf8');
    // Player is project-owned; compute stays on world-render Actor (no local LLM client).
    expect(engine).toContain("from './player/engine.ts'");
    expect(engine).not.toContain('@seashort/runtime-immersive-chat');
    expect(engine).not.toContain('SdkLlmClient');
    expect(engine).not.toContain('ProxyLLMClient');
    expect(main).toContain('PlayerCore');
    expect(main).toContain("from './player/PlayerCore.tsx'");
    expect(main).not.toContain('/player/App.tsx');
  });

  test('assertPureCommand rejects banned keys but allows "card" in text values', () => {
    expect(() =>
      assertPureCommand({
        commandId: '1',
        expectedRevision: 0,
        kind: 'send',
        input: { text: 'show me the "card" please' },
      }),
    ).not.toThrow();
    expect(() =>
      assertPureCommand({
        commandId: '1',
        expectedRevision: 0,
        kind: 'send',
        // @ts-expect-error intentional smuggle
        card: { name: 'x' },
      } as ActorCommandRequest),
    ).toThrow(/card/);
    expect(() =>
      assertPureCommand({
        commandId: '1',
        expectedRevision: 0,
        kind: 'backtrack',
        // @ts-expect-error intentional
        keepMessages: 2,
      } as ActorCommandRequest),
    ).toThrow(/keepMessages/);
    expect(() =>
      assertPureCommand({
        commandId: 'cfg-smuggle',
        expectedRevision: 1,
        kind: 'configure',
        // @ts-expect-error full preset is forbidden; only presetPatch is allowed
        input: { preset: { prompts: [] } },
      } as ActorCommandRequest),
    ).toThrow(/preset/);
    expect(() =>
      assertPureCommand({
        commandId: 'cfg-world',
        expectedRevision: 1,
        kind: 'configure',
        // @ts-expect-error create-only worldSpec smuggle
        input: { worldSpec: {} },
      } as ActorCommandRequest),
    ).toThrow(/worldSpec/);
    expect(() =>
      assertPureCommand({
        commandId: 'cfg-secret',
        expectedRevision: 1,
        kind: 'configure',
        // @ts-expect-error credentials are transport-only
        input: { llmApiKey: 'sk-must-not-enter-command' },
      } as ActorCommandRequest),
    ).toThrow(/llmApiKey/);
  });

  test('create session body uses model object + camelCase config', async () => {
    const creates: ActorCreateSessionRequest[] = [];
    const authContexts: unknown[] = [];
    const transport: ActorTransport = {
      async createSession(body, context) {
        creates.push(body);
        authContexts.push(context);
        return {
          sessionId: 'neg-create',
          revision: 1,
          projection: { messages: [{ role: 'assistant', content: 'hi', name: CARD.name }] },
        };
      },
      async getSession() {
        return null;
      },
      async postCommand() {
        throw new Error('not used');
      },
    };
    setActorTransport(transport);
    const engine = new ActorEngine(CARD, {
      model: 'deepseek-v4-flash',
      config: { maxContext: 64000, maxTokens: 32000 },
      llmMode: 'stub',
    });
    engine.setActorAuthorization('sk-request-only');
    await engine.whenReady();
    expect(creates).toHaveLength(1);
    expect(creates[0]!.model).toEqual(
      expect.objectContaining({ model: 'deepseek-v4-flash', maxTokens: 32000 }),
    );
    expect(creates[0]!.config).toEqual({ maxContext: 64000, maxTokens: 32000 });
    expect(JSON.stringify(creates[0])).not.toContain('sk-request-only');
    expect(authContexts[0]).toEqual({ bearerToken: 'sk-request-only' });
  });

  test('HTTP transport puts credential in Authorization only', async () => {
    const calls: Array<{ headers: Headers; body: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ''),
      });
      return new Response(JSON.stringify({
        sessionId: 'auth-session',
        revision: 1,
        projection: { messages: [] },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await browserActorTransport.createSession(
        {
          card: CARD,
          config: { maxContext: 32000, maxTokens: 512 },
          model: { model: 'stub' },
          llmMode: 'stub',
        },
        { bearerToken: 'sk-request-only' },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer sk-request-only');
    expect(calls[0]!.body).not.toContain('sk-request-only');
    expect(calls[0]!.body).not.toContain('llmApiKey');
  });

  test('command JSON never includes snapshot/card/preset/worldInfo keys', async () => {
    const commands: ActorCommandRequest[] = [];
    const transport: ActorTransport = {
      async createSession() {
        return {
          sessionId: 'neg-1',
          revision: 1,
          projection: {
            messages: [{ role: 'assistant', content: 'hi', name: CARD.name }],
          },
        };
      },
      async getSession() {
        return null;
      },
      async postCommand(_id, body) {
        commands.push(body);
        assertPureCommand(body);
        const sse = [
          'event: turn.committed',
          `data: ${JSON.stringify({
            type: 'turn.committed',
            revision: 2,
            projection: {
              messages: [
                { role: 'assistant', content: 'hi', name: CARD.name },
                { role: 'user', content: body.input?.text ?? '' },
                { role: 'assistant', content: 'ok', name: CARD.name },
              ],
            },
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
    const engine = new ActorEngine(CARD, { llmMode: 'stub' });
    await engine.whenReady();
    await engine.send('ping with "card" in text');
    expect(commands.length).toBe(1);
    expect(commands[0]?.kind).toBe('send');
  });

  test('production dist excludes Actor orchestration call-sites (engine must not drive LLM stream)', () => {
    const dist = join(ROOT, 'dist');
    if (!existsSync(dist)) {
      expect(true).toBe(true);
      return;
    }
    const files = walkFiles(dist).filter((p) => p.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);
    const banned = [
      /this\.llm\.chatStream\s*\(/,
      /phase:\s*['"]prepare['"]/,
      /phase:\s*['"]commit['"]/,
      /assemblePrompt\s*\(/,
      /scanWorldInfo\s*\(/,
      /ProxyLLMClient/,
      /\/st-llm/,
    ];
    let sawActorProtocol = false;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('expectedRevision') || text.includes('/api/worldcompute')) {
        sawActorProtocol = true;
      }
      for (const re of banned) {
        expect(re.test(text)).toBe(false);
      }
    }
    expect(sawActorProtocol).toBe(true);
  });
});
