/**
 * Accept-script process env helpers.
 *
 * Local Vite / localhost must bypass HTTP/SOCKS proxies (otherwise fetch hangs).
 * Keep https_proxy / http_proxy / all_proxy for outbound if the shell set them.
 */
const LOCAL_NO_PROXY = '127.0.0.1,localhost,::1';

function mergeNoProxy(existing: string | undefined): string {
  const parts = new Set<string>();
  for (const piece of `${existing ?? ''},${LOCAL_NO_PROXY}`.split(',')) {
    const t = piece.trim();
    if (t) parts.add(t);
  }
  return [...parts].join(',');
}

/** Apply NO_PROXY/no_proxy onto process.env (idempotent). */
export function installLocalNoProxy(): void {
  process.env.NO_PROXY = mergeNoProxy(process.env.NO_PROXY);
  process.env.no_proxy = mergeNoProxy(process.env.no_proxy);
}

/** Clone env for child processes (Vite, hard gates). */
export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  installLocalNoProxy();
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  env.NO_PROXY = mergeNoProxy(env.NO_PROXY);
  env.no_proxy = mergeNoProxy(env.no_proxy);
  return env;
}

export { LOCAL_NO_PROXY };
