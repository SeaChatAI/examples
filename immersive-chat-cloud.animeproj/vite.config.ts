import { defineCardViteConfig } from '@seashort/card-kit/vite';
import { worldcomputePlugin, actorProxyTable } from './vite.worldcompute-plugin.ts';

// Port 5288 — not 5273 — sibling immersive-chat keeps default.
export default defineCardViteConfig({
  port: Number(process.env.WEBIDE_PORT) || 5288,
  plugins: [worldcomputePlugin()],
  extend: {
    // Proxy must live in the resolved config (not only a plugin config hook) —
    // card-kit base already sets server.proxy; mergeConfig deep-merges keys.
    server: {
      proxy: actorProxyTable(),
    },
    resolve: {
      dedupe: ['@seachat/sdk', '@seachat/sdk/render'],
    },
  },
});
