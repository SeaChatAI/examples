/**
 * Embedded Experience shell contract — this project only.
 * Does not own multi-card catalog / shared player host APIs.
 *
 * UI lives in project-owned `src/player/**` (vendored from runtime-immersive-chat).
 * Compute stays on cloud worldcompute via @seachat/sdk/render.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('embedded cloud Actor Experience contract', () => {
  test('boots project-owned PlayerCore with actorPlayerRuntime + single card.json', () => {
    const main = source('src/main.tsx');
    const pkg = JSON.parse(source('package.json')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('seashort-immersive-chat-cloud');
    // Player UI is project-owned; compute/auth via unified @seachat/sdk (scheme B).
    expect(pkg.dependencies['@seashort/runtime-immersive-chat']).toBeUndefined();
    expect(pkg.dependencies['@seashort/world-render']).toBeUndefined();
    expect(pkg.dependencies['@seachat/sdk']).toMatch(/seachat-sdk/);
    expect(main).toContain('createRoot');
    expect(main).toContain('<PlayerCore');
    expect(main).toContain("from './player/PlayerCore.tsx'");
    expect(main).toContain('runtime={actorPlayerRuntime}');
    expect(main).toContain('installActorTransport');
    expect(main).toContain("from './card.json'");
    expect(main).toMatch(/\['text',\s*'regex',\s*'json'\]\s*as const/);
    expect(main).not.toContain('bootImmersiveChat');
    expect(main).not.toContain('mountImmersiveChat');
    expect(main).not.toContain('?cardId=');
    expect(main).not.toContain('@seashort/runtime-immersive-chat');
  });

  test('is embedded runtime identity (not multi-card host)', () => {
    const identity = JSON.parse(source('.seashort/runtime-identity.json')) as {
      kind: string;
      template: string;
      version: number;
    };
    expect(identity.version).toBe(1);
    expect(identity.kind).toBe('embedded');
    expect(identity.template).toBe('immersive-chat-cloud');
  });

  test('uses browser-safe bearer identity without retired runtime-key minting', () => {
    const identity = source('src/player/identity-connection.ts');
    const acceptance = source('scripts/accept-cloud-ui.ts');
    expect(identity).toContain('isUsableSeaChatCredential');
    expect(identity).toContain('storage: volatileCredentialStorage');
    expect(identity).not.toContain("startsWith('sk-')");
    expect(identity).not.toContain('localStorage');
    expect(acceptance).toContain('/api/seagate/v1/auth/email/session');
    expect(acceptance).toContain("type: 'seachat-platform-auth-push'");
    expect(acceptance).toContain('window.setInterval');
    expect(acceptance).not.toContain('localStorage');
    expect(acceptance).not.toContain('/api/keys/runtime/desktop');
    expect(acceptance).not.toContain('browserRuntimeKey');
  });

  test('card seeds Play publish readiness fields and top/data stay aligned', () => {
    const envelope = JSON.parse(source('src/card.json')) as {
      name?: string;
      description?: string;
      tags?: string[];
      first_mes?: string;
      data: {
        name?: string;
        description?: string;
        tags?: string[];
        first_mes?: string;
        extensions?: { seashort?: Record<string, unknown> };
      };
    };
    const data = envelope.data;
    const seashort = data.extensions?.seashort ?? {};
    expect((data.name ?? '').length).toBeGreaterThan(0);
    expect((data.description ?? '').trim().length).toBeGreaterThan(0);
    expect((data.tags ?? []).length).toBeGreaterThan(0);
    expect(seashort.category).toBe('roleplay');
    expect(seashort.gender).toBe('male');
    expect(seashort.nsfw).toBe(false);
    expect(seashort.cover).toBeTruthy();
    // ccv3 dual layer: top mirrors data for the fields we publish
    expect(envelope.name).toBe(data.name);
    expect(envelope.description).toBe(data.description);
    expect(envelope.tags).toEqual(data.tags);
    expect(envelope.first_mes).toBe(data.first_mes);
  });

  test('engine re-exports project-owned actorPlayerRuntime (cloud Actor default)', () => {
    const engine = source('src/engine.ts');
    const localActor = source('src/player/actor-player-runtime.ts');
    expect(engine).toContain('actorPlayerRuntime');
    expect(engine).toContain("from './player/engine.ts'");
    expect(engine).toContain('ensureActorTransport');
    expect(engine).not.toContain('@seashort/runtime-immersive-chat');
    expect(engine).not.toContain('new WorldEngine(');
    expect(engine).not.toContain('SdkLlmClient');
    expect(engine).not.toContain('RemoteWorldEngine');
    // Product Actor runtime lives in this Experience's player tree.
    expect(localActor).toContain('new ActorEngine');
    expect(localActor).toContain("persistMode: 'actor-handle'");
    expect(localActor).toContain('worldIdForBound');
    expect(localActor).toContain('cloneFromSessionId');
  });

  test('transport is shared world-render SSOT (no forked HTTP client)', () => {
    const adapter = source('src/actor-transport.ts');
    const main = source('src/main.tsx');
    // Thin re-export — product HTTP transport lives in @seachat/sdk/render.
    expect(adapter).toContain("from '@seachat/sdk/render/render'");
    expect(adapter).toContain('installBrowserActorTransport as installActorTransport');
    expect(adapter).toContain('browserActorTransport');
    expect(adapter).not.toContain('async createSession');
    expect(adapter).not.toContain('async listSessions');
    expect(main).toContain('installActorTransport');
    expect(existsSync(join(ROOT, 'vendor/world-engine/package.json'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/rust-compute.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'public/catalog'))).toBe(false);
  });

  test('production dist targets seachat.ai worldcompute', () => {
    const distJs = join(ROOT, 'dist/assets');
    if (!existsSync(distJs)) return;
    const files = readdirSync(distJs).filter((f) => f.endsWith('.js'));
    const blob = files.map((f) => readFileSync(join(distJs, f), 'utf8')).join('\n');
    expect(blob).toContain('https://seachat.ai');
    expect(blob).toContain('/api/worldcompute');
    expect(blob).not.toContain('__rust_compute');
  });

  test('ships project cover asset referenced by the card', () => {
    const envelope = JSON.parse(source('src/card.json')) as {
      data?: { extensions?: { seashort?: { cover?: { path?: string } } } };
    };
    const coverPath = envelope.data?.extensions?.seashort?.cover?.path;
    expect(typeof coverPath).toBe('string');
    expect(existsSync(join(ROOT, coverPath!))).toBe(true);
  });

  test('src surface is boot wiring + project-owned player', () => {
    const srcDir = join(ROOT, 'src');
    const files = readdirSync(srcDir).filter((f) => !f.startsWith('.'));
    expect(files.sort()).toEqual([
      'actor-transport.ts',
      'card.json',
      'engine.ts',
      'main.tsx',
      'player',
    ]);
    expect(existsSync(join(ROOT, 'src/player/PlayerCore.tsx'))).toBe(true);
    expect(existsSync(join(ROOT, 'src/player/ORIGIN.md'))).toBe(true);
  });

  test('project-owned player ships verified product model surface', () => {
    const models = source('src/player/models.ts');
    for (const id of [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'grok-4.5',
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
    ]) {
      expect(models).toContain(`'${id}'`);
    }
  });
});
