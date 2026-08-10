import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PlayerCore from './player/PlayerCore.tsx';
import { bindCard, type CardEnvelope } from './player/card.ts';
import cardEnvelope from './card.json';
import { installActorTransport } from './actor-transport.ts';
import { actorPlayerRuntime } from './engine.ts';

/** Actor session protocols this Experience enables. */
const ACTOR_PROTOCOLS = ['text', 'regex', 'json'] as const;

/**
 * Embedded Experience: project-owned PlayerCore + cloud worldcompute.
 * Single boot path: install transport → bind card.json → mount local PlayerCore.
 * Auth: SeaChat login → Authorization only.
 */
function wantDebugChrome(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('debug');
  } catch {
    return false;
  }
}

/** Dev chrome — never shown on published Experience unless ?debug=1. */
function mountDebugChrome(): void {
  if (!wantDebugChrome()) return;
  const chip = document.createElement('div');
  chip.id = 'compute-backend-badge';
  chip.textContent = 'DEBUG · cloud worldcompute';
  chip.title = 'seachatUrl(/api/worldcompute) · TS render only';
  chip.setAttribute('aria-label', chip.textContent);
  chip.style.cssText = [
    'position:fixed',
    'z-index:99999',
    'top:8px',
    'left:50%',
    'transform:translateX(-50%)',
    'padding:6px 12px',
    'border-radius:999px',
    'font:600 11px/1.2 ui-sans-serif,system-ui',
    'letter-spacing:0.04em',
    'pointer-events:none',
    'background:#0d3b2e',
    'color:#7dffa8',
    'border:1px solid #1f6b4a',
  ].join(';');
  document.body.appendChild(chip);
}

async function boot() {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('#root missing');

  installActorTransport();
  mountDebugChrome();

  rootEl.innerHTML =
    '<div style="padding:24px;font:14px/1.5 system-ui;opacity:.7">Loading…</div>';

  try {
    const bound = bindCard(cardEnvelope as CardEnvelope);
    createRoot(rootEl).render(
      <StrictMode>
        <PlayerCore
          bound={bound}
          runtime={actorPlayerRuntime}
          supportedProtocols={ACTOR_PROTOCOLS}
        />
      </StrictMode>,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rootEl.innerHTML =
      `<pre style="padding:24px;color:#f88;font:14px/1.5 system-ui;white-space:pre-wrap">`
      + `Failed to start:\n${message}\n\n`
      + `Please sign in to SeaChat and try again.`
      + `</pre>`;
  }
}

void boot();
