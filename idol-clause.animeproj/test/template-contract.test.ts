import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PKG = join(ROOT, '../../sdks/seachat-sdk/play');
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const pkgSource = (path: string) => readFileSync(join(PKG, path), 'utf8');

describe('immersive chat template contract', () => {
  test('is a thin shared-runtime shell (not an embedded full UI fork)', () => {
    const main = source('src/main.tsx');
    const pkg = JSON.parse(source('package.json')) as {
      dependencies: Record<string, string>;
    };
    const runtime = JSON.parse(source('.seashort/runtime-identity.json')) as {
      kind: string;
      runtime: string;
    };
    expect(pkg.dependencies['@seachat/sdk']).toBeTruthy();
    expect(main).toContain('bootImmersiveChat');
    expect(main).toContain('@seachat/sdk/play');
    expect(runtime.kind).toBe('shared');
    expect(runtime.runtime).toBe('immersive-chat');
    // Process descriptor must never be the identity SSOT.
    expect(existsSync(join(ROOT, '.seashort/runtime-identity.json'))).toBe(true);
    expect(existsSync(join(ROOT, 'src/App.tsx'))).toBe(false);
  });

  test('contains no example character hardcoding in the shell', () => {
    const main = source('src/main.tsx');
    const exampleSubtitle = ['A TALKING', ' CAT'].join('');
    const exampleName = ['三', '三'].join('');
    expect(main).not.toContain(exampleSubtitle);
    expect(main).not.toContain(exampleName);
  });

  test('shared player drives identity from the bound card envelope', () => {
    const core = pkgSource('src/player/PlayerCore.tsx');
    expect(core).toContain('deriveCardPresentation');
    expect(core).toContain('PRESENTATION.coverUrl');
    expect(core).toContain('PRESENTATION.inputPlaceholder');
  });

  test('shared player defaults to cloud Actor runtime', () => {
    const app = pkgSource('src/player/App.tsx');
    const actor = pkgSource('src/player/actor-player-runtime.ts');
    expect(app).toContain('actorPlayerRuntime');
    expect(actor).toContain('ActorEngine');
    expect(actor).toContain("persistMode: 'actor-handle'");
  });

  test('shared player exposes lifecycle controls', () => {
    const core = pkgSource('src/player/PlayerCore.tsx');
    const actions = pkgSource('src/player/chat-actions.ts');
    expect(core).toContain('AbortController');
    expect(actions).toContain('retryLast');
    expect(actions).toContain('backtrackLast');
    expect(actions).toContain('continueLast');
  });

  test('shared player layout is a flex conversation stack', () => {
    const styles = pkgSource('src/player/styles.css');
    expect(styles).toContain('height: 100dvh');
    expect(styles).toContain('.conversation');
    expect(styles).toContain('flex-direction: column');
    expect(styles).toContain('env(safe-area-inset-bottom)');
    expect(styles).toContain('@media (max-width: 760px)');
  });

  test('keeps card cover as a project asset under public/assets', () => {
    const card = JSON.parse(source('src/card.json'));
    const cover = card.data.extensions.seashort.cover;
    expect(cover.kind).toBe('project_asset');
    expect(String(cover.path)).toMatch(/^public\/assets\//);
    const asset = join(ROOT, cover.path);
    expect(existsSync(asset)).toBe(true);
  });

  test('isolates sessions by card identity in the shared player', () => {
    const store = pkgSource('src/player/session-store.ts');
    expect(store).toContain('worldIdForBound');
    expect(store).toContain('localNamespaceForBound');
  });

  test('shared player product model surface is closed Flash + Pro list', () => {
    const models = pkgSource('src/player/models.ts');
    for (const id of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
      expect(models).toContain(`'${id}'`);
    }
    expect(models).toContain('DEFAULT_CHAT_MODEL');
    expect(models).toContain('availableChatModels');
    expect(models).toContain('CHAT_MODEL_OPTIONS');
  });
});
