import {
  bootImmersiveChat,
  type CardEnvelope,
} from '@seachat/sdk/play';
import cardEnvelope from './card.json';

/**
 * Host create_project seed: thin shell over shared immersive-chat runtime.
 * One player serves N cards — only card.json is project-owned content.
 */
async function boot() {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('#root missing');

  try {
    await bootImmersiveChat(rootEl, {
      resolve: {
        fallback: cardEnvelope as CardEnvelope,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rootEl.innerHTML = `<pre style="padding:24px;color:#f88;font:14px/1.5 system-ui">Failed to start player:\n${message}</pre>`;
  }
}

void boot();
