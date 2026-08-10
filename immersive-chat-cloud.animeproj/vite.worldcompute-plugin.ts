/**
 * Optional Vite proxy for local dogfood when you force a same-origin Actor base.
 *
 * Product default (src/actor-transport.ts) calls the platform SSOT absolute URL:
 *   worldcomputeBaseUrl() → https://seachat.ai/api/worldcompute
 *
 * This plugin only matters if you set:
 *   VITE_WORLD_COMPUTE_BROWSER_BASE=/__worldcompute
 * so the browser hits the Vite origin and we rewrite to the cloud facade.
 */
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const { HttpsProxyAgent } = require('https-proxy-agent') as {
  HttpsProxyAgent: typeof import('https-proxy-agent').HttpsProxyAgent;
};

/** Loose proxy shape — avoid coupling to a specific vite install's ProxyOptions. */
type LooseProxy = {
  target: string;
  changeOrigin?: boolean;
  rewrite?: (path: string) => string;
  configure?: (proxyServer: any, options: any) => void;
};

// Product SSOT (mirrors @seachat/sdk worldcomputeBaseUrl). Do NOT import
// @seachat/sdk here: Node loads vite.config without TS path resolution, and
// platform/src/* uses .js specifier for .ts sources → ERR_MODULE_NOT_FOUND.
const DEFAULT_SEACHAT_ORIGIN = 'https://seachat.ai';
const CLOUD_BASE = (() => {
  const origin = (process.env.SEACHAT_ORIGIN || DEFAULT_SEACHAT_ORIGIN).replace(/\/$/, '');
  return `${origin}/api/worldcompute`;
})();
const PROXY_TARGET = (
  process.env.WORLD_COMPUTE_URL?.replace(/\/$/, '') || CLOUD_BASE
);
const { getProxyForUrl } = require('proxy-from-env') as {
  getProxyForUrl(url: string): string;
};
const RESOLVED_TARGET = PROXY_TARGET.startsWith('http') ? PROXY_TARGET : CLOUD_BASE;
const OUTBOUND_PROXY = getProxyForUrl(RESOLVED_TARGET);
const OUTBOUND_AGENT = OUTBOUND_PROXY && RESOLVED_TARGET.startsWith('https:')
  ? new HttpsProxyAgent(OUTBOUND_PROXY)
  : undefined;

/** Same-origin dogfood prefix (not the product default base). */
const DOGFOOD_PREFIX = '/__worldcompute';

function actorProxy(rewritePath: string | ((path: string) => string)): LooseProxy {
  return {
    target: RESOLVED_TARGET,
    changeOrigin: true,
    rewrite: typeof rewritePath === 'function' ? rewritePath : () => rewritePath,
    configure(proxyServer, options) {
      if (OUTBOUND_AGENT) options.agent = OUTBOUND_AGENT;
      proxyServer.on('error', (error: Error, _request: unknown, response: unknown) => {
        const message =
          `worldcompute proxy target unreachable at ${RESOLVED_TARGET} (${error.message}).`;
        console.error(`[worldcompute] ${message}`);
        if (response && typeof response === 'object' && 'writeHead' in response) {
          (response as import('http').ServerResponse).writeHead(502, {
            'Content-Type': 'application/json',
          });
          (response as import('http').ServerResponse).end(
            JSON.stringify({ error: message, actor: RESOLVED_TARGET }),
          );
        }
      });
    },
  };
}

/** Optional same-origin rewrite table for dogfood overrides. */
export function actorProxyTable(): Record<string, string | LooseProxy> {
  return {
    [`${DOGFOOD_PREFIX}/sessions`]: actorProxy((path) =>
      path.replace(new RegExp(`^${DOGFOOD_PREFIX}/sessions`), '/sessions'),
    ),
    [`${DOGFOOD_PREFIX}/health`]: actorProxy('/health'),
  };
}

export function worldcomputePlugin(): Plugin {
  const proxy = actorProxyTable();

  return {
    name: 'worldcompute-actor-proxy',
    config() {
      return {
        server: { proxy },
        preview: { proxy },
      };
    },
    configureServer(server) {
      console.info(
        `[worldcompute] product default Actor = ${CLOUD_BASE}`
        + `  (optional same-origin override: ${DOGFOOD_PREFIX} → cloud)`,
      );
      fetch(`${CLOUD_BASE}/health`)
        .then(async (r) => {
          if (r.ok) {
            console.info(`[worldcompute] cloud health:`, await r.json());
          } else {
            console.warn(`[worldcompute] ${CLOUD_BASE}/health → ${r.status}`);
          }
        })
        .catch((error: Error) => {
          console.warn(
            `[worldcompute] health check failed (${error.message}). Need network to seachat.ai.`,
          );
        });
      void server;
    },
  };
}
